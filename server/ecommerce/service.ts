import { randomUUID } from "node:crypto";
import {
  generateEcommerceImages,
  generateProductCopy,
  type EcommerceImageGenerationResult,
  type ProductCopy
} from "../../src/ecommerceGeneration.js";
import { createEcommerceTaskRepositoryFromEnv } from "./repository.js";
import { createObjectStorageFromEnv } from "./storage.js";
import type {
  CreateEcommerceTaskInput,
  EcommerceProductImageRecord,
  EcommerceServiceDependencies,
  EcommerceTaskImageRecord,
  EcommerceTaskRecord,
  EcommerceTaskRepository,
  EcommerceTaskStatus,
  ListEcommerceTasksInput,
  ObjectStorage
} from "./types.js";

function defaultNow() {
  return new Date();
}

function defaultCreateId() {
  return `ecommerce-task-${randomUUID()}`;
}

function assertNonEmpty(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ecommerce task failed.";
}

class EcommerceDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcommerceDeliveryError";
  }
}

function isCompleteProductCopy(copy: ProductCopy | undefined | null): copy is ProductCopy {
  return Boolean(
    copy &&
      Array.isArray(copy.sellingPoints) &&
      copy.sellingPoints.length >= 3 &&
      copy.sellingPoints.slice(0, 3).every((point: string) => point.trim()) &&
      copy.longTitle.trim() &&
      copy.shortTitle.trim()
  );
}

function normalizeCopy(copy: ProductCopy): ProductCopy {
  return {
    sellingPoints: copy.sellingPoints.slice(0, 3).map((point: string) => point.trim()),
    longTitle: copy.longTitle.trim(),
    shortTitle: copy.shortTitle.trim()
  };
}

function decodeBase64(data: string) {
  const cleanData = data.includes(",") ? data.split(",").at(-1) ?? data : data;
  return Buffer.from(cleanData, "base64");
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  if (mimeType.includes("gif")) {
    return "gif";
  }
  return "png";
}

function sanitizeFileName(fileName: string, fallback: string) {
  const normalized = fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  return normalized || fallback;
}

function terminalGenerationStatus(images: EcommerceTaskImageRecord[]): EcommerceTaskStatus {
  return images.length > 0 && images.every((image) => image.status === "success") ? "completed" : "failed";
}

function missingDefaultDependency(name: string): never {
  throw new Error(`${name} is not configured.`);
}

function resolveRepository(deps: { repository?: EcommerceTaskRepository }): EcommerceTaskRepository {
  return deps.repository ?? createEcommerceTaskRepositoryFromEnv();
}

function resolveStorage(deps: { storage?: ObjectStorage }): ObjectStorage {
  return deps.storage ?? createObjectStorageFromEnv();
}

function validateCreateInput(input: CreateEcommerceTaskInput) {
  assertNonEmpty(input.apiKey, "API Key is required.");
  assertNonEmpty(input.baseUrl, "Base URL is required.");
  assertNonEmpty(input.productTitle, "Product title is required.");
  assertNonEmpty(input.textModel, "Text model is required.");
  assertNonEmpty(input.imageModel, "Image model is required.");
  assertNonEmpty(input.productImage?.data ?? "", "Product image is required.");
  assertNonEmpty(input.productImage?.mimeType ?? "", "Product image MIME type is required.");
}

async function resolveCopy(input: CreateEcommerceTaskInput, deps: EcommerceServiceDependencies) {
  if (isCompleteProductCopy(input.copy)) {
    return normalizeCopy(input.copy);
  }

  const copy = await (deps.generateCopy ?? generateProductCopy)({
    apiKey: input.apiKey.trim(),
    baseUrl: input.baseUrl.trim(),
    model: input.textModel.trim(),
    productTitle: input.productTitle.trim()
  });
  return normalizeCopy(copy);
}

async function putObjectForDelivery(input: Parameters<ObjectStorage["putObject"]>[0], storage: ObjectStorage) {
  try {
    return await storage.putObject(input);
  } catch (error) {
    throw new EcommerceDeliveryError(errorMessage(error));
  }
}

async function uploadProductImage(input: {
  request: CreateEcommerceTaskInput;
  storage: ObjectStorage;
  taskId: string;
  productImageName: string;
  productBody: Buffer;
}): Promise<EcommerceProductImageRecord> {
  const productObjectKey = `ecommerce/${input.taskId}/source/${sanitizeFileName(input.productImageName, "product.png")}`;
  const productObject = await putObjectForDelivery(
    {
      objectKey: productObjectKey,
      mimeType: input.request.productImage.mimeType,
      body: input.productBody,
      metadata: {
        ecommerceTaskId: input.taskId,
        ecommerceImageRole: "source"
      }
    },
    input.storage
  );

  return {
    name: input.productImageName,
    mimeType: input.request.productImage.mimeType,
    objectKey: productObject.objectKey,
    cosUrl: productObject.cosUrl,
    size: input.productBody.byteLength,
    width: input.request.productImage.width,
    height: input.request.productImage.height
  };
}

async function uploadGeneratedImage(input: {
  result: Extract<EcommerceImageGenerationResult, { status: "success" }>;
  storage: ObjectStorage;
  taskId: string;
}) {
  const extension = extensionFromMimeType(input.result.image.image.mimeType);
  const imageName = sanitizeFileName(`${input.result.name}.${extension}`, `${input.result.type}.${extension}`);
  const objectKey = `ecommerce/${input.taskId}/images/${imageName}`;
  const stored = await putObjectForDelivery(
    {
      objectKey,
      mimeType: input.result.image.image.mimeType,
      body: decodeBase64(input.result.image.image.data),
      metadata: {
        ecommerceTaskId: input.taskId,
        ecommerceImageType: input.result.type
      }
    },
    input.storage
  );

  return {
    type: input.result.type,
    label: input.result.label,
    title: input.result.title,
    name: input.result.name,
    prompt: input.result.image.prompt,
    mimeType: input.result.image.image.mimeType,
    objectKey: stored.objectKey,
    cosUrl: stored.cosUrl,
    createdAt: input.result.image.createdAt,
    status: "success" as const,
    cost: null
  };
}

function failedImageRecord(result: Extract<EcommerceImageGenerationResult, { status: "failed" }>, createdAt: string): EcommerceTaskImageRecord {
  return {
    type: result.type,
    label: result.label,
    title: result.title,
    name: result.name,
    prompt: "",
    mimeType: null,
    objectKey: null,
    cosUrl: null,
    createdAt,
    status: "failed",
    error: result.error,
    cost: null
  };
}

export async function createEcommerceTask(
  input: CreateEcommerceTaskInput,
  deps: EcommerceServiceDependencies = {}
): Promise<EcommerceTaskRecord> {
  validateCreateInput(input);

  const repository = resolveRepository(deps);
  const createdAt = (deps.now ?? defaultNow)().toISOString();
  const taskId = (deps.createId ?? defaultCreateId)();
  const productImageName = input.productImage.name || "product.png";
  const productBody = decodeBase64(input.productImage.data);
  const task: EcommerceTaskRecord = {
    id: taskId,
    productTitle: input.productTitle.trim(),
    productImageName,
    productImage: {
      name: productImageName,
      mimeType: input.productImage.mimeType,
      objectKey: null,
      cosUrl: null,
      size: productBody.byteLength,
      width: input.productImage.width,
      height: input.productImage.height
    },
    productCopy: isCompleteProductCopy(input.copy) ? normalizeCopy(input.copy) : null,
    textModel: input.textModel.trim(),
    imageModel: input.imageModel.trim(),
    imageSize: input.imageSize,
    status: "queued",
    cost: null,
    userId: input.userId ?? null,
    createdAt,
    updatedAt: createdAt,
    images: []
  };

  const created = await repository.create(task);
  await repository.enqueueTaskInput(taskId, input);
  return created;
}

export async function runEcommerceTask(
  taskId: string,
  input: CreateEcommerceTaskInput,
  deps: EcommerceServiceDependencies = {}
): Promise<EcommerceTaskRecord> {
  validateCreateInput(input);

  const repository = resolveRepository(deps);
  const existing = await repository.getById(taskId, input.userId ?? null);
  if (!existing) {
    throw new Error(`Ecommerce task ${taskId} was not found.`);
  }

  const now = deps.now ?? defaultNow;
  let productImage = existing.productImage;
  let productCopy = existing.productCopy;
  let images = existing.images;
  const runningTask = await repository.update({
    ...existing,
    status: "running",
    error: undefined,
    updatedAt: now().toISOString()
  });

  try {
    const storage = resolveStorage(deps);
    const productImageName = input.productImage.name || "product.png";
    const productBody = decodeBase64(input.productImage.data);
    productImage = await uploadProductImage({
      request: input,
      storage,
      taskId,
      productImageName,
      productBody
    });

    productCopy = await resolveCopy(input, deps);
    const generationResults = await (deps.generateImages ?? generateEcommerceImages)({
      apiKey: input.apiKey.trim(),
      baseUrl: input.baseUrl.trim(),
      imageModel: input.imageModel.trim(),
      imageSize: input.imageSize,
      productImage: input.productImage,
      productTitle: input.productTitle.trim(),
      copy: productCopy
    });

    images = [];
    for (const result of generationResults) {
      if (result.status === "success") {
        images.push(await uploadGeneratedImage({ result, storage, taskId }));
      } else {
        images.push(failedImageRecord(result, now().toISOString()));
      }
    }

    const status = terminalGenerationStatus(images);
    const firstImageError = images.find((image) => image.status === "failed")?.error;
    return repository.update({
      ...runningTask,
      productImage,
      productCopy,
      images,
      status,
      error: status === "failed" ? firstImageError ?? "Ecommerce image generation failed." : undefined,
      updatedAt: now().toISOString()
    });
  } catch (error) {
    const status: EcommerceTaskStatus = error instanceof EcommerceDeliveryError ? "delivery_failed" : "failed";
    return repository.update({
      ...runningTask,
      productImage,
      productCopy,
      images,
      status,
      error: errorMessage(error),
      updatedAt: now().toISOString()
    });
  }
}

export async function getEcommerceTask(
  id: string,
  deps: Partial<Pick<EcommerceServiceDependencies, "repository">> & { userId?: string | null } = {}
): Promise<EcommerceTaskRecord | null> {
  assertNonEmpty(id, "Task ID is required.");
  const repository = resolveRepository(deps);
  return repository.getById(id.trim(), deps.userId ?? null);
}

export async function listEcommerceTasks(
  input: ListEcommerceTasksInput,
  deps: Partial<Pick<EcommerceServiceDependencies, "repository">> = {}
): Promise<EcommerceTaskRecord[]> {
  const repository = resolveRepository(deps);
  const limit = Number.isFinite(input.limit) ? Math.min(100, Math.max(1, Math.trunc(input.limit))) : 30;
  return repository.list(limit, input.userId ?? null);
}

export async function runNextQueuedEcommerceTask(
  deps: EcommerceServiceDependencies & {
    workerId?: string;
    staleAfterMs?: number;
  } = {}
): Promise<EcommerceTaskRecord | null> {
  const repository = resolveRepository(deps);
  const job = await repository.claimNextQueuedTask({
    workerId: deps.workerId ?? `worker-${process.pid}`,
    now: (deps.now ?? defaultNow)(),
    staleAfterMs: deps.staleAfterMs ?? 15 * 60 * 1000
  });
  if (!job) {
    return null;
  }

  const task = await runEcommerceTask(job.task.id, job.input, deps);
  await repository.completeQueuedTask(task.id, task.status);
  return task;
}

export function scheduleEcommerceTask(
  taskId: string,
  input: CreateEcommerceTaskInput,
  deps: EcommerceServiceDependencies = {}
) {
  const job = async () => {
    await runEcommerceTask(taskId, input, deps);
  };

  if (deps.enqueueTask) {
    deps.enqueueTask(job);
    return;
  }

  if (process.env.ECOMMERCE_INLINE_WORKER === "0") {
    return;
  }

  void job().catch((error) => {
    console.error(errorMessage(error));
  });
}

export function requireConfiguredServiceDependency<T>(value: T | undefined, name: string): T {
  return value ?? missingDefaultDependency(name);
}
