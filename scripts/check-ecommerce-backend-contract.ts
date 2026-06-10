import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  handleCreateEcommerceTaskRequest,
  handleGetEcommerceTaskRequest,
  handleListEcommerceTasksRequest
} from "../server/ecommerce/http";
import { createLocalEcommerceTaskRepository } from "../server/ecommerce/repository";
import {
  createEcommerceTask,
  getEcommerceTask,
  listEcommerceTasks,
  runEcommerceTask,
  runNextQueuedEcommerceTask
} from "../server/ecommerce/service";
import { createLocalObjectStorage } from "../server/ecommerce/storage";
import type {
  CreateEcommerceTaskInput,
  EcommerceServiceDependencies,
  EcommerceTaskRecord,
  EcommerceTaskRepository,
  ObjectStorage,
  StoredObject
} from "../server/ecommerce/types";
import { ECOMMERCE_IMAGE_TASKS, type EcommerceImageGenerationResult, type ProductCopy } from "../src/ecommerceGeneration";

const fixedNow = new Date("2026-06-08T10:00:00.000Z");
const productCopy: ProductCopy = {
  sellingPoints: ["hydrating", "portable", "gift ready"],
  longTitle: "Portable hydration skincare set",
  shortTitle: "Hydration set"
};

const request: CreateEcommerceTaskInput = {
  apiKey: "provider-key",
  baseUrl: "https://api.lts4ai.com",
  productTitle: "Portable hydration skincare set",
  productImage: {
    id: "product-image",
    name: "product photo.png",
    mimeType: "image/png",
    data: Buffer.from("source-image").toString("base64"),
    dataUrl: `data:image/png;base64,${Buffer.from("source-image").toString("base64")}`,
    size: Buffer.byteLength("source-image"),
    originalSize: Buffer.byteLength("source-image"),
    width: 800,
    height: 800
  },
  textModel: "gpt-5.5",
  imageModel: "gpt-image-2",
  imageSize: "1K"
};

function generatedImages(): EcommerceImageGenerationResult[] {
  return ECOMMERCE_IMAGE_TASKS.map((task) => ({
    type: task.type,
    label: task.label,
    title: task.title,
    name: task.name,
    status: "success" as const,
    image: {
      id: `generated-${task.type}`,
      type: task.type,
      label: task.label,
      title: task.title,
      name: task.name,
      prompt: `prompt-${task.type}`,
      createdAt: "2026-06-08T10:00:01.000Z",
      image: {
        data: Buffer.from(`image-${task.type}`).toString("base64"),
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${Buffer.from(`image-${task.type}`).toString("base64")}`
      }
    }
  }));
}

function cloneTask(task: EcommerceTaskRecord): EcommerceTaskRecord {
  return JSON.parse(JSON.stringify(task)) as EcommerceTaskRecord;
}

function createFakes(options: { failObjectKeyIncludes?: string } = {}) {
  const uploads: Array<{ objectKey: string; mimeType: string; body: Buffer }> = [];
  const writes: EcommerceTaskRecord[] = [];
  const tasks = new Map<string, EcommerceTaskRecord>();
  const jobs = new Map<
    string,
    {
      input: CreateEcommerceTaskInput;
      status: "queued" | "running" | EcommerceTaskRecord["status"];
      lockedBy: string | null;
      lockedAt: string | null;
      completedStatus: EcommerceTaskRecord["status"] | null;
    }
  >();

  const storage: ObjectStorage = {
    async putObject(input): Promise<StoredObject> {
      if (options.failObjectKeyIncludes && input.objectKey.includes(options.failObjectKeyIncludes)) {
        throw new Error(`COS upload failed for ${input.objectKey}`);
      }
      uploads.push({
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        body: Buffer.from(input.body)
      });
      return {
        objectKey: input.objectKey,
        cosUrl: `https://cos.example.com/${encodeURIComponent(input.objectKey)}`
      };
    }
  };

  const repository: EcommerceTaskRepository = {
    async create(task) {
      const stored = cloneTask(task);
      tasks.set(task.id, stored);
      writes.push(stored);
      return cloneTask(stored);
    },
    async update(task) {
      const stored = cloneTask(task);
      tasks.set(task.id, stored);
      writes.push(stored);
      return cloneTask(stored);
    },
    async getById(id) {
      const task = tasks.get(id);
      return task ? cloneTask(task) : null;
    },
    async list(limit, userId) {
      return Array.from(tasks.values())
        .filter((task) => !userId || task.userId === userId)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, limit)
        .map(cloneTask);
    },
    async enqueueTaskInput(taskId, input) {
      jobs.set(taskId, {
        input,
        status: "queued",
        lockedBy: null,
        lockedAt: null,
        completedStatus: null
      });
    },
    async claimNextQueuedTask(input) {
      const entry = Array.from(jobs.entries()).find(([, job]) => job.status === "queued");
      if (!entry) {
        return null;
      }
      const [taskId, job] = entry;
      const task = tasks.get(taskId);
      assert.ok(task, "Claimed job must have a task.");
      job.status = "running";
      job.lockedBy = input.workerId;
      job.lockedAt = input.now.toISOString();
      return {
        task: cloneTask(task),
        input: job.input
      };
    },
    async completeQueuedTask(taskId, status) {
      const job = jobs.get(taskId);
      assert.ok(job, "Completed job must exist.");
      job.status = status;
      job.completedStatus = status;
    }
  };

  return { repository, storage, tasks, uploads, writes, jobs };
}

function createDeps(fakes: ReturnType<typeof createFakes>, taskId: string): EcommerceServiceDependencies {
  return {
    repository: fakes.repository,
    storage: fakes.storage,
    now: () => fixedNow,
    createId: () => taskId,
    generateCopy: async (input) => {
      assert.equal(input.apiKey, request.apiKey);
      assert.equal(input.baseUrl, request.baseUrl);
      assert.equal(input.model, request.textModel);
      assert.equal(input.productTitle, request.productTitle);
      return productCopy;
    },
    generateImages: async (input) => {
      assert.equal(input.apiKey, request.apiKey);
      assert.equal(input.baseUrl, request.baseUrl);
      assert.equal(input.imageModel, request.imageModel);
      assert.equal(input.imageSize, request.imageSize);
      assert.equal(input.productImage.name, request.productImage.name);
      assert.deepEqual(input.copy, productCopy);
      return generatedImages();
    }
  };
}

const fakes = createFakes();
let inlineCopyCalls = 0;
let inlineImageCalls = 0;
const queued = await createEcommerceTask(request, {
  ...createDeps(fakes, "task-abc"),
  generateCopy: async () => {
    inlineCopyCalls += 1;
    return productCopy;
  },
  generateImages: async () => {
    inlineImageCalls += 1;
    return generatedImages();
  }
});

assert.equal(queued.id, "task-abc");
assert.equal(queued.status, "queued");
assert.equal(queued.cost, null);
assert.equal(queued.userId, null);
assert.equal(queued.productTitle, request.productTitle);
assert.equal(queued.productImageName, "product photo.png");
assert.equal(queued.productImage.name, "product photo.png");
assert.equal(queued.productImage.objectKey, null);
assert.equal(queued.productImage.cosUrl, null);
assert.equal(queued.productCopy, null);
assert.equal(queued.images.length, 0);
assert.equal(queued.createdAt, fixedNow.toISOString());
assert.equal(queued.updatedAt, fixedNow.toISOString());
assert.equal(inlineCopyCalls, 0, "Task creation must not call the upstream text generator inline.");
assert.equal(inlineImageCalls, 0, "Task creation must not call the upstream image generator inline.");
assert.equal(fakes.uploads.length, 0, "Task creation must not upload images before the background worker runs.");
assert.deepEqual(fakes.writes.map((task) => task.status), ["queued"]);
assert.equal(fakes.jobs.size, 1, "Task creation must persist the worker payload for durable execution.");
assert.equal(fakes.jobs.get("task-abc")?.status, "queued");
assert.equal(fakes.jobs.get("task-abc")?.input.productTitle, request.productTitle);

const completed = await runEcommerceTask(queued.id, request, createDeps(fakes, "unused-id"));
assert.equal(completed.id, "task-abc");
assert.equal(completed.status, "completed");
assert.equal(completed.productImage.objectKey, "ecommerce/task-abc/source/product-photo.png");
assert.equal(completed.productImage.cosUrl, "https://cos.example.com/ecommerce%2Ftask-abc%2Fsource%2Fproduct-photo.png");
assert.equal(completed.images.length, 4);
assert.equal(completed.images[0].type, "main");
assert.equal(completed.images[0].status, "success");
assert.equal(completed.images[0].objectKey, "ecommerce/task-abc/images/main.png");
assert.equal(completed.images[0].cosUrl, "https://cos.example.com/ecommerce%2Ftask-abc%2Fimages%2Fmain.png");
assert.equal("imageDataUrl" in completed.images[0], false, "Server image records should use cosUrl/objectKey instead of data URLs.");
assert.deepEqual(completed.productCopy, productCopy);
assert.deepEqual(fakes.writes.map((task) => task.status), ["queued", "running", "completed"]);
assert.equal(fakes.uploads.length, 5, "Source image plus four generated images should be uploaded by the worker.");
assert.equal(fakes.uploads[0].objectKey, "ecommerce/task-abc/source/product-photo.png");
assert.equal(fakes.uploads[0].body.toString(), "source-image");
assert.equal(fakes.uploads[1].objectKey, "ecommerce/task-abc/images/main.png");
assert.equal(fakes.uploads[1].body.toString(), "image-main");

const byId = await getEcommerceTask("task-abc", { repository: fakes.repository });
assert.deepEqual(byId, completed);

const listed = await listEcommerceTasks({ limit: 10 }, { repository: fakes.repository });
assert.deepEqual(listed, [completed]);

const workerFakes = createFakes();
const workerQueued = await createEcommerceTask(request, createDeps(workerFakes, "task-worker"));
const workerCompleted = await runNextQueuedEcommerceTask({
  ...createDeps(workerFakes, "unused-id"),
  workerId: "contract-worker",
  staleAfterMs: 60_000
});
assert.equal(workerCompleted?.id, workerQueued.id);
assert.equal(workerCompleted?.status, "completed");
assert.equal(workerFakes.jobs.get(workerQueued.id)?.lockedBy, "contract-worker");
assert.equal(workerFakes.jobs.get(workerQueued.id)?.completedStatus, "completed");
assert.equal(await runNextQueuedEcommerceTask({ ...createDeps(workerFakes, "unused-id"), workerId: "contract-worker" }), null);

const suppliedCopyFakes = createFakes();
let suppliedCopyGeneratorCalls = 0;
const suppliedCopyQueued = await createEcommerceTask(
  {
    ...request,
    copy: productCopy
  },
  {
    ...createDeps(suppliedCopyFakes, "task-supplied-copy"),
    generateCopy: async () => {
      suppliedCopyGeneratorCalls += 1;
      throw new Error("Copy generator should not run when copy is supplied.");
    }
  }
);
const suppliedCopyCompleted = await runEcommerceTask(
  suppliedCopyQueued.id,
  {
    ...request,
    copy: productCopy
  },
  {
    ...createDeps(suppliedCopyFakes, "unused-id"),
    generateCopy: async () => {
      suppliedCopyGeneratorCalls += 1;
      throw new Error("Copy generator should not run when copy is supplied.");
    }
  }
);
assert.equal(suppliedCopyGeneratorCalls, 0);
assert.equal(suppliedCopyCompleted.status, "completed");
assert.deepEqual(suppliedCopyCompleted.productCopy, productCopy);

const deliveryFakes = createFakes({ failObjectKeyIncludes: "/images/main.png" });
const deliveryQueued = await createEcommerceTask(request, createDeps(deliveryFakes, "task-delivery"));
const deliveryFailed = await runEcommerceTask(deliveryQueued.id, request, createDeps(deliveryFakes, "unused-id"));
assert.equal(deliveryFailed.status, "delivery_failed");
assert.match(deliveryFailed.error ?? "", /COS upload failed/);
assert.deepEqual(deliveryFakes.writes.map((task) => task.status), ["queued", "running", "delivery_failed"]);

const providerFakes = createFakes();
const providerQueued = await createEcommerceTask(request, createDeps(providerFakes, "task-provider-failed"));
const providerFailed = await runEcommerceTask(providerQueued.id, request, {
  ...createDeps(providerFakes, "unused-id"),
  generateImages: async () => {
    throw new Error("Provider timed out.");
  }
});
assert.equal(providerFailed.status, "failed");
assert.match(providerFailed.error ?? "", /Provider timed out/);

const httpFakes = createFakes();
const backgroundJobs: Array<() => Promise<void>> = [];
const httpCreated = await handleCreateEcommerceTaskRequest(
  {
    ...request,
    copy: productCopy
  },
  {
    ...createDeps(httpFakes, "task-http"),
    enqueueTask: (job) => {
      backgroundJobs.push(job);
    }
  }
);
assert.equal(httpCreated.status, 202);
assert.equal((httpCreated.body as { taskId: string }).taskId, "task-http");
assert.equal((httpCreated.body as { task: EcommerceTaskRecord }).task.status, "queued");
assert.equal(backgroundJobs.length, 1);
assert.equal(httpFakes.uploads.length, 0);

await backgroundJobs[0]();
const httpPolled = await handleGetEcommerceTaskRequest(
  { id: "task-http" },
  {
    repository: httpFakes.repository
  }
);
assert.equal(httpPolled.status, 200);
assert.equal((httpPolled.body as { task: EcommerceTaskRecord }).task.status, "completed");

const httpListed = await handleListEcommerceTasksRequest(
  { limit: "5" },
  {
    repository: httpFakes.repository
  }
);
assert.equal(httpListed.status, 200);
assert.equal((httpListed.body as { tasks: EcommerceTaskRecord[] }).tasks[0].id, "task-http");

const httpMissing = await handleGetEcommerceTaskRequest(
  { id: "missing-task" },
  {
    repository: httpFakes.repository
  }
);
assert.equal(httpMissing.status, 404);
assert.equal((httpMissing.body as { task: EcommerceTaskRecord | null }).task, null);

const httpFailed = await handleCreateEcommerceTaskRequest(
  {},
  {
    repository: httpFakes.repository,
    storage: httpFakes.storage
  }
);
assert.equal(httpFailed.status, 400);
assert.match((httpFailed.body as { error: string }).error, /required/i);

const tempDir = await mkdtemp(path.join(tmpdir(), "ecommerce-backend-"));
const localStorage = createLocalObjectStorage({
  rootDir: path.join(tempDir, "objects"),
  publicBaseUrl: "http://localhost:8787/local-cos"
});
const localStored = await localStorage.putObject({
  objectKey: "ecommerce/task-local/source/product.png",
  mimeType: "image/png",
  body: Buffer.from("local-bytes")
});
assert.equal(localStored.objectKey, "ecommerce/task-local/source/product.png");
assert.equal(localStored.cosUrl, "http://localhost:8787/local-cos/ecommerce/task-local/source/product.png");
assert.equal((await readFile(path.join(tempDir, "objects", "ecommerce", "task-local", "source", "product.png"))).toString(), "local-bytes");

const localRepository = createLocalEcommerceTaskRepository({
  filePath: path.join(tempDir, "tasks.json")
});
await localRepository.create(queued);
await localRepository.enqueueTaskInput(queued.id, request);
const localClaimed = await localRepository.claimNextQueuedTask({
  workerId: "local-worker",
  now: fixedNow,
  staleAfterMs: 60_000
});
assert.equal(localClaimed?.task.id, queued.id);
assert.equal(localClaimed?.input.productTitle, request.productTitle);
await localRepository.completeQueuedTask(queued.id, "completed");
await localRepository.update(completed);
const reloadedRepository = createLocalEcommerceTaskRepository({
  filePath: path.join(tempDir, "tasks.json")
});
const localTask = await reloadedRepository.getById("task-abc");
assert.deepEqual(localTask, completed);
const localList = await reloadedRepository.list(10);
assert.deepEqual(localList, [completed]);

console.log("Ecommerce backend contract checks passed.");
