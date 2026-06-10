import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mysql, { type Pool as MySqlPool, type RowDataPacket } from "mysql2/promise";
import { Pool as PgPool } from "pg";
import type {
  ClaimQueuedEcommerceTaskInput,
  ClaimedEcommerceTask,
  CreateEcommerceTaskInput,
  EcommerceTaskRecord,
  EcommerceTaskRepository,
  EcommerceTaskStatus
} from "./types.js";
import { getLocalEcommerceDataDir } from "./storage.js";

export interface LocalEcommerceTaskRepositoryOptions {
  filePath: string;
}

type EcommerceTaskJobStatus = "queued" | "running" | EcommerceTaskStatus;

interface LocalEcommerceTaskJob {
  taskId: string;
  input: CreateEcommerceTaskInput;
  status: EcommerceTaskJobStatus;
  lockedBy: string | null;
  lockedAt: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface MySqlEcommerceTaskRepositoryOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readLocalTasks(filePath: string): Promise<EcommerceTaskRecord[]> {
  const parsed = await readJsonFile<unknown>(filePath, []);
  return Array.isArray(parsed) ? (parsed as EcommerceTaskRecord[]) : [];
}

async function writeLocalTasks(filePath: string, tasks: EcommerceTaskRecord[]) {
  await writeJsonFile(filePath, tasks);
}

async function readLocalJobs(filePath: string): Promise<LocalEcommerceTaskJob[]> {
  const parsed = await readJsonFile<unknown>(filePath, []);
  return Array.isArray(parsed) ? (parsed as LocalEcommerceTaskJob[]) : [];
}

async function writeLocalJobs(filePath: string, jobs: LocalEcommerceTaskJob[]) {
  await writeJsonFile(filePath, jobs);
}

function sortTasks(tasks: EcommerceTaskRecord[]) {
  return tasks.slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function parseJsonRecord<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function formatMysqlDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const pad = (input: number, length = 2) => String(input).padStart(length, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

function escapeMysqlIdentifier(identifier: string) {
  if (!identifier.trim()) {
    throw new Error("MySQL database name is required.");
  }
  return `\`${identifier.replace(/`/gu, "``")}\``;
}

function splitHostPort(value: string, fallbackPort: number) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.+):(\d+)$/u);
  if (!match) {
    return { host: trimmed, port: fallbackPort };
  }
  return { host: match[1], port: Number.parseInt(match[2], 10) || fallbackPort };
}

function isDuplicateMysqlIndexError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ER_DUP_KEYNAME");
}

async function createMysqlIndexIfMissing(pool: MySqlPool, indexName: string, tableName: string, columns: string) {
  try {
    await pool.query(
      `create index ${escapeMysqlIdentifier(indexName)} on ${escapeMysqlIdentifier(tableName)} (${columns})`
    );
  } catch (error) {
    if (!isDuplicateMysqlIndexError(error)) {
      throw error;
    }
  }
}

export function createLocalEcommerceTaskRepository(options: LocalEcommerceTaskRepositoryOptions): EcommerceTaskRepository {
  const jobsFilePath = `${options.filePath}.jobs.json`;

  return {
    async create(task: EcommerceTaskRecord) {
      const tasks = await readLocalTasks(options.filePath);
      const nextTasks = sortTasks([task, ...tasks.filter((item) => item.id !== task.id)]);
      await writeLocalTasks(options.filePath, nextTasks);
      return task;
    },
    async update(task: EcommerceTaskRecord) {
      const tasks = await readLocalTasks(options.filePath);
      const nextTasks = sortTasks([task, ...tasks.filter((item) => item.id !== task.id)]);
      await writeLocalTasks(options.filePath, nextTasks);
      return task;
    },
    async getById(id: string, userId?: string | null) {
      const tasks = await readLocalTasks(options.filePath);
      return tasks.find((task) => task.id === id && (!userId || task.userId === userId)) ?? null;
    },
    async list(limit: number, userId?: string | null) {
      const tasks = sortTasks(await readLocalTasks(options.filePath));
      const filtered = userId ? tasks.filter((task) => task.userId === userId) : tasks;
      return filtered.slice(0, limit);
    },
    async enqueueTaskInput(taskId: string, input: CreateEcommerceTaskInput) {
      const now = new Date().toISOString();
      const jobs = await readLocalJobs(jobsFilePath);
      const nextJob: LocalEcommerceTaskJob = {
        taskId,
        input,
        status: "queued",
        lockedBy: null,
        lockedAt: null,
        attempts: jobs.find((job) => job.taskId === taskId)?.attempts ?? 0,
        createdAt: jobs.find((job) => job.taskId === taskId)?.createdAt ?? now,
        updatedAt: now
      };
      await writeLocalJobs(jobsFilePath, [nextJob, ...jobs.filter((job) => job.taskId !== taskId)]);
    },
    async claimNextQueuedTask(input: ClaimQueuedEcommerceTaskInput): Promise<ClaimedEcommerceTask | null> {
      const tasks = await readLocalTasks(options.filePath);
      const jobs = await readLocalJobs(jobsFilePath);
      const staleBefore = input.now.getTime() - input.staleAfterMs;
      const job = jobs
        .slice()
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .find(
          (candidate) =>
            candidate.status === "queued" ||
            (candidate.status === "running" &&
              candidate.lockedAt !== null &&
              Number.isFinite(Date.parse(candidate.lockedAt)) &&
              Date.parse(candidate.lockedAt) < staleBefore)
        );
      if (!job) {
        return null;
      }

      const task = tasks.find((candidate) => candidate.id === job.taskId);
      if (!task) {
        return null;
      }

      const updatedJobs = jobs.map((candidate) =>
        candidate.taskId === job.taskId
          ? {
              ...candidate,
              status: "running" as const,
              lockedBy: input.workerId,
              lockedAt: input.now.toISOString(),
              attempts: candidate.attempts + 1,
              updatedAt: input.now.toISOString()
            }
          : candidate
      );
      await writeLocalJobs(jobsFilePath, updatedJobs);
      return { task, input: job.input };
    },
    async completeQueuedTask(taskId: string, status: EcommerceTaskStatus) {
      const now = new Date().toISOString();
      const jobs = await readLocalJobs(jobsFilePath);
      await writeLocalJobs(
        jobsFilePath,
        jobs.map((job) => (job.taskId === taskId ? { ...job, status, updatedAt: now } : job))
      );
    }
  };
}

export class PostgresEcommerceTaskRepository implements EcommerceTaskRepository {
  private readonly pool: PgPool;
  private schemaReady: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new PgPool({
      connectionString,
      max: 3
    });
  }

  private ensureSchema() {
    this.schemaReady ??= this.pool
      .query(`
        create table if not exists ecommerce_tasks (
          id text primary key,
          user_id text,
          created_at timestamptz not null,
          updated_at timestamptz not null,
          task jsonb not null
        );
        create index if not exists ecommerce_tasks_created_at_idx on ecommerce_tasks (created_at desc);
        create index if not exists ecommerce_tasks_user_created_idx on ecommerce_tasks (user_id, created_at desc);

        create table if not exists ecommerce_task_jobs (
          task_id text primary key references ecommerce_tasks(id) on delete cascade,
          status text not null,
          payload jsonb not null,
          locked_by text,
          locked_at timestamptz,
          attempts integer not null default 0,
          created_at timestamptz not null,
          updated_at timestamptz not null
        );
        create index if not exists ecommerce_task_jobs_status_created_idx on ecommerce_task_jobs (status, created_at);
      `)
      .then(() => undefined);
    return this.schemaReady;
  }

  private async upsert(task: EcommerceTaskRecord) {
    await this.ensureSchema();
    await this.pool.query(
      `
        insert into ecommerce_tasks (id, user_id, created_at, updated_at, task)
        values ($1, $2, $3, $4, $5::jsonb)
        on conflict (id) do update set
          user_id = excluded.user_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          task = excluded.task
      `,
      [task.id, task.userId, task.createdAt, task.updatedAt, JSON.stringify(task)]
    );
    return task;
  }

  async create(task: EcommerceTaskRecord) {
    return this.upsert(task);
  }

  async update(task: EcommerceTaskRecord) {
    return this.upsert(task);
  }

  async getById(id: string, userId?: string | null) {
    await this.ensureSchema();
    const result = await this.pool.query<{ task: EcommerceTaskRecord }>(
      `
        select task
        from ecommerce_tasks
        where id = $1 and ($2::text is null or user_id = $2)
        limit 1
      `,
      [id, userId ?? null]
    );
    return result.rows.map((row) => parseJsonRecord<EcommerceTaskRecord>(row.task))[0] ?? null;
  }

  async list(limit: number, userId?: string | null) {
    await this.ensureSchema();
    const result = await this.pool.query<{ task: EcommerceTaskRecord }>(
      `
        select task
        from ecommerce_tasks
        where ($2::text is null or user_id = $2)
        order by created_at desc
        limit $1
      `,
      [limit, userId ?? null]
    );
    return result.rows.map((row) => parseJsonRecord<EcommerceTaskRecord>(row.task));
  }

  async enqueueTaskInput(taskId: string, input: CreateEcommerceTaskInput) {
    await this.ensureSchema();
    const now = new Date().toISOString();
    await this.pool.query(
      `
        insert into ecommerce_task_jobs (task_id, status, payload, attempts, created_at, updated_at)
        values ($1, 'queued', $2::jsonb, 0, $3, $3)
        on conflict (task_id) do update set
          status = 'queued',
          payload = excluded.payload,
          locked_by = null,
          locked_at = null,
          updated_at = excluded.updated_at
      `,
      [taskId, JSON.stringify(input), now]
    );
  }

  async claimNextQueuedTask(input: ClaimQueuedEcommerceTaskInput): Promise<ClaimedEcommerceTask | null> {
    await this.ensureSchema();
    const staleBefore = new Date(input.now.getTime() - input.staleAfterMs).toISOString();
    const result = await this.pool.query<{ task_id: string; payload: CreateEcommerceTaskInput }>(
      `
        with candidate as (
          select task_id
          from ecommerce_task_jobs
          where status = 'queued'
             or (status = 'running' and locked_at is not null and locked_at < $3)
          order by created_at asc
          for update skip locked
          limit 1
        )
        update ecommerce_task_jobs
        set status = 'running',
            locked_by = $1,
            locked_at = $2,
            attempts = attempts + 1,
            updated_at = $2
        where task_id in (select task_id from candidate)
        returning task_id, payload
      `,
      [input.workerId, input.now.toISOString(), staleBefore]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const task = await this.getById(row.task_id);
    return task ? { task, input: parseJsonRecord<CreateEcommerceTaskInput>(row.payload) } : null;
  }

  async completeQueuedTask(taskId: string, status: EcommerceTaskStatus) {
    await this.ensureSchema();
    await this.pool.query(
      `
        update ecommerce_task_jobs
        set status = $2,
            updated_at = $3
        where task_id = $1
      `,
      [taskId, status, new Date().toISOString()]
    );
  }
}

export class MySqlEcommerceTaskRepository implements EcommerceTaskRepository {
  private readonly pool: MySqlPool;
  private readonly options: MySqlEcommerceTaskRepositoryOptions;
  private schemaReady: Promise<void> | null = null;

  constructor(options: MySqlEcommerceTaskRepositoryOptions) {
    this.options = options;
    this.pool = mysql.createPool({
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      database: options.database,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10_000,
      charset: "utf8mb4"
    });
  }

  private async ensureSchema() {
    this.schemaReady ??= (async () => {
      const setup = await mysql.createConnection({
        host: this.options.host,
        port: this.options.port,
        user: this.options.user,
        password: this.options.password,
        connectTimeout: 10_000
      });
      await setup.query(
        `create database if not exists ${escapeMysqlIdentifier(
          this.options.database
        )} character set utf8mb4 collate utf8mb4_unicode_ci`
      );
      await setup.end();

      await this.pool.query(`
        create table if not exists ecommerce_tasks (
          id varchar(191) primary key,
          user_id varchar(191) null,
          created_at datetime(3) not null,
          updated_at datetime(3) not null,
          task json not null,
          index ecommerce_tasks_created_at_idx (created_at desc),
          index ecommerce_tasks_user_created_idx (user_id, created_at desc)
        ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
      `);
      await this.pool.query(`
        create table if not exists ecommerce_task_jobs (
          task_id varchar(191) primary key,
          status varchar(32) not null,
          payload json not null,
          locked_by varchar(191) null,
          locked_at datetime(3) null,
          attempts int not null default 0,
          created_at datetime(3) not null,
          updated_at datetime(3) not null,
          index ecommerce_task_jobs_status_created_idx (status, created_at),
          constraint ecommerce_task_jobs_task_fk foreign key (task_id) references ecommerce_tasks(id) on delete cascade
        ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
      `);
      await createMysqlIndexIfMissing(this.pool, "ecommerce_tasks_created_at_idx", "ecommerce_tasks", "created_at desc");
      await createMysqlIndexIfMissing(
        this.pool,
        "ecommerce_tasks_user_created_idx",
        "ecommerce_tasks",
        "user_id, created_at desc"
      );
      await createMysqlIndexIfMissing(
        this.pool,
        "ecommerce_task_jobs_status_created_idx",
        "ecommerce_task_jobs",
        "status, created_at"
      );
      await createMysqlIndexIfMissing(
        this.pool,
        "ecommerce_task_jobs_status_locked_created_idx",
        "ecommerce_task_jobs",
        "status, locked_at, created_at"
      );
    })();
    return this.schemaReady;
  }

  private async upsert(task: EcommerceTaskRecord) {
    await this.ensureSchema();
    await this.pool.execute(
      `
        insert into ecommerce_tasks (id, user_id, created_at, updated_at, task)
        values (?, ?, ?, ?, cast(? as json))
        on duplicate key update
          user_id = values(user_id),
          created_at = values(created_at),
          updated_at = values(updated_at),
          task = values(task)
      `,
      [task.id, task.userId, formatMysqlDate(task.createdAt), formatMysqlDate(task.updatedAt), JSON.stringify(task)]
    );
    return task;
  }

  async create(task: EcommerceTaskRecord) {
    return this.upsert(task);
  }

  async update(task: EcommerceTaskRecord) {
    return this.upsert(task);
  }

  async getById(id: string, userId?: string | null) {
    await this.ensureSchema();
    const [rows] = userId
      ? await this.pool.execute<RowDataPacket[]>(
          `
            select task
            from ecommerce_tasks
            where id = ? and user_id = ?
            limit 1
          `,
          [id, userId]
        )
      : await this.pool.execute<RowDataPacket[]>(
          `
            select task
            from ecommerce_tasks
            where id = ?
            limit 1
          `,
          [id]
        );
    return rows[0] ? parseJsonRecord<EcommerceTaskRecord>(rows[0].task) : null;
  }

  async list(limit: number, userId?: string | null) {
    await this.ensureSchema();
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const [rows] = userId
      ? await this.pool.execute<RowDataPacket[]>(
          `
            select task
            from ecommerce_tasks
            where user_id = ?
            order by created_at desc
            limit ${safeLimit}
          `,
          [userId]
        )
      : await this.pool.execute<RowDataPacket[]>(
          `
            select task
            from ecommerce_tasks
            order by created_at desc
            limit ${safeLimit}
          `
        );
    return rows.map((row) => parseJsonRecord<EcommerceTaskRecord>(row.task));
  }

  async enqueueTaskInput(taskId: string, input: CreateEcommerceTaskInput) {
    await this.ensureSchema();
    const now = formatMysqlDate(new Date());
    await this.pool.execute(
      `
        insert into ecommerce_task_jobs (task_id, status, payload, attempts, created_at, updated_at)
        values (?, 'queued', cast(? as json), 0, ?, ?)
        on duplicate key update
          status = 'queued',
          payload = values(payload),
          locked_by = null,
          locked_at = null,
          updated_at = values(updated_at)
      `,
      [taskId, JSON.stringify(input), now, now]
    );
  }

  async claimNextQueuedTask(input: ClaimQueuedEcommerceTaskInput): Promise<ClaimedEcommerceTask | null> {
    await this.ensureSchema();
    const staleBefore = formatMysqlDate(new Date(input.now.getTime() - input.staleAfterMs));
    const lockedAt = formatMysqlDate(input.now);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `
          select task_id
          from ecommerce_task_jobs
          where status = 'queued'
          order by created_at asc
          limit 1
          for update skip locked
        `
      );
      let row = rows[0];
      if (!row) {
        const [staleRows] = await connection.execute<RowDataPacket[]>(
          `
            select task_id
            from ecommerce_task_jobs
            where status = 'running'
              and locked_at is not null
              and locked_at < ?
            order by locked_at asc, created_at asc
            limit 1
            for update skip locked
          `,
          [staleBefore]
        );
        row = staleRows[0];
      }
      if (!row) {
        await connection.commit();
        return null;
      }

      await connection.execute(
        `
          update ecommerce_task_jobs
          set status = 'running',
              locked_by = ?,
              locked_at = ?,
              attempts = attempts + 1,
              updated_at = ?
          where task_id = ?
        `,
        [input.workerId, lockedAt, lockedAt, row.task_id]
      );
      const [payloadRows] = await connection.execute<RowDataPacket[]>(
        `
          select payload
          from ecommerce_task_jobs
          where task_id = ?
          limit 1
        `,
        [row.task_id]
      );
      await connection.commit();

      const task = await this.getById(row.task_id);
      return task && payloadRows[0]
        ? { task, input: parseJsonRecord<CreateEcommerceTaskInput>(payloadRows[0].payload) }
        : null;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async completeQueuedTask(taskId: string, status: EcommerceTaskStatus) {
    await this.ensureSchema();
    const now = formatMysqlDate(new Date());
    await this.pool.execute(
      `
        update ecommerce_task_jobs
        set status = ?,
            updated_at = ?
        where task_id = ?
      `,
      [status, now, taskId]
    );
  }
}

function mysqlOptionsFromUrl(rawUrl: string): MySqlEcommerceTaskRepositoryOptions {
  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\/+/u, "")) || "ai_image"
  };
}

function mysqlOptionsFromEnv(env: NodeJS.ProcessEnv): MySqlEcommerceTaskRepositoryOptions {
  const rawUrl = env.ECOMMERCE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (rawUrl?.startsWith("mysql://") || rawUrl?.startsWith("mysql2://")) {
    return mysqlOptionsFromUrl(rawUrl);
  }

  const hostPort = splitHostPort(
    env.ECOMMERCE_MYSQL_HOST?.trim() || env.MYSQL_HOST?.trim() || env.DB_HOST?.trim() || "",
    Number.parseInt(env.ECOMMERCE_MYSQL_PORT ?? env.MYSQL_PORT ?? env.DB_PORT ?? "3306", 10) || 3306
  );
  if (!hostPort.host) {
    throw new Error("ECOMMERCE_MYSQL_HOST or DB_HOST is required for MySQL ecommerce repository.");
  }

  return {
    host: hostPort.host,
    port: hostPort.port,
    user: env.ECOMMERCE_MYSQL_USER?.trim() || env.MYSQL_USER?.trim() || env.DB_USER?.trim() || "",
    password: env.ECOMMERCE_MYSQL_PASSWORD ?? env.MYSQL_PASSWORD ?? env.DB_PASSWORD ?? "",
    database: env.ECOMMERCE_MYSQL_DATABASE?.trim() || env.MYSQL_DATABASE?.trim() || env.DB_NAME?.trim() || "ai_image"
  };
}

let cachedRepository: EcommerceTaskRepository | null = null;

export function createEcommerceTaskRepositoryFromEnv(env: NodeJS.ProcessEnv = process.env): EcommerceTaskRepository {
  const dbType = (env.ECOMMERCE_DB_TYPE || env.DB_TYPE || "").trim().toLowerCase();
  const connectionString = env.ECOMMERCE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  const isMySql =
    dbType === "mysql" ||
    Boolean(env.ECOMMERCE_MYSQL_HOST || env.MYSQL_HOST || env.DB_HOST) ||
    Boolean(connectionString?.startsWith("mysql://") || connectionString?.startsWith("mysql2://"));

  if (isMySql) {
    cachedRepository ??= new MySqlEcommerceTaskRepository(mysqlOptionsFromEnv(env));
    return cachedRepository;
  }

  if (connectionString) {
    cachedRepository ??= new PostgresEcommerceTaskRepository(connectionString);
    return cachedRepository;
  }

  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new Error("A database connection is required in production.");
  }

  return createLocalEcommerceTaskRepository({
    filePath: path.join(getLocalEcommerceDataDir(env), "ecommerce-tasks.json")
  });
}
