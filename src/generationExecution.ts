export const MAX_PARALLEL_GENERATION_TASKS = 10;

export interface SettleGenerationTasksOptions<TTask> {
  maxAttempts?: number;
  retryDelayMs?: number;
  shouldRetry?: (reason: unknown, task: TTask, attempt: number) => boolean;
}

export function resolveGenerationParallelism(totalTasks: number) {
  const taskCount = Number.isFinite(totalTasks) ? Math.trunc(totalTasks) : 0;
  return Math.min(MAX_PARALLEL_GENERATION_TASKS, Math.max(0, taskCount));
}

function normalizeAttemptCount(value: number | undefined) {
  return Math.max(1, Number.isFinite(value) ? Math.trunc(value ?? 1) : 1);
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function settleGenerationTasks<TTask, TResult>(
  tasks: TTask[],
  runTask: (task: TTask) => Promise<TResult>,
  options: SettleGenerationTasksOptions<TTask> = {}
): Promise<PromiseSettledResult<TResult>[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: PromiseSettledResult<TResult>[] = new Array(tasks.length);
  const parallelism = resolveGenerationParallelism(tasks.length);
  const maxAttempts = normalizeAttemptCount(options.maxAttempts);
  const retryDelayMs = Math.max(0, Number.isFinite(options.retryDelayMs) ? Math.trunc(options.retryDelayMs ?? 0) : 0);
  let nextTaskIndex = 0;

  async function runTaskWithRetries(task: TTask) {
    let attempt = 1;
    while (true) {
      try {
        return await runTask(task);
      } catch (reason) {
        const canRetry =
          attempt < maxAttempts && (options.shouldRetry ? options.shouldRetry(reason, task, attempt) : true);
        if (!canRetry) {
          throw reason;
        }
        attempt += 1;
        await delay(retryDelayMs);
      }
    }
  }

  async function worker() {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;

      try {
        results[taskIndex] = { status: "fulfilled", value: await runTaskWithRetries(tasks[taskIndex]) };
      } catch (reason) {
        results[taskIndex] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: parallelism }, worker));
  return results;
}
