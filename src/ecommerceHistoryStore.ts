import type { ProductCopy } from "./ecommerceGeneration";
import type { ImageSize, InputImage } from "./types";

export type EcommerceTaskStatus = "queued" | "running" | "completed" | "delivery_failed" | "failed";
export type EcommerceHistoryImageStatus = "success" | "failed";

export interface EcommerceCost {
  amount: number | null;
  currency: string | null;
  detail?: Record<string, unknown>;
}

export interface EcommerceHistoryImage {
  type: string;
  label: string;
  title: string;
  name: string;
  imageDataUrl?: string;
  cosUrl?: string | null;
  objectKey?: string | null;
  mimeType: string | null;
  prompt: string;
  createdAt: string;
  status?: EcommerceHistoryImageStatus;
  error?: string;
  cost?: EcommerceCost | null;
}

export interface EcommerceHistoryItem {
  id: string;
  productTitle: string;
  productImageName: string;
  productImage?: {
    name: string;
    mimeType: string;
    objectKey: string | null;
    cosUrl: string | null;
    size: number;
    width?: number;
    height?: number;
  };
  productCopy: ProductCopy;
  textModel: string;
  imageModel: string;
  imageSize: ImageSize;
  createdAt: string;
  updatedAt?: string;
  status?: EcommerceTaskStatus;
  error?: string;
  cost?: EcommerceCost | null;
  userId?: string | null;
  images: EcommerceHistoryImage[];
}

export interface CreateStoredEcommerceTaskInput {
  apiKey: string;
  baseUrl: string;
  productTitle: string;
  productImage: InputImage;
  textModel: string;
  imageModel: string;
  imageSize: ImageSize;
  copy?: ProductCopy;
}

export interface CreateStoredEcommerceTaskResult {
  taskId: string;
  task: EcommerceHistoryItem;
}

function defaultEcommerceApiBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "" : "https://dy.ctikki.com";
}

const ECOMMERCE_API_BASE_URL = (import.meta.env.VITE_ECOMMERCE_API_BASE_URL || defaultEcommerceApiBaseUrl()).replace(
  /\/+$/u,
  ""
);

function ecommerceApiUrl(path: string) {
  return `${ECOMMERCE_API_BASE_URL}${path}`;
}

function ecommerceAssetUrl(objectKey: string) {
  return ecommerceApiUrl(
    `/api/ecommerce/assets/${objectKey
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`
  );
}

const EMPTY_PRODUCT_COPY: ProductCopy = {
  sellingPoints: ["", "", ""],
  longTitle: "",
  shortTitle: ""
};

function normalizeCopy(input: unknown): ProductCopy {
  if (!input || typeof input !== "object") {
    return EMPTY_PRODUCT_COPY;
  }

  const candidate = input as Partial<ProductCopy>;
  const sellingPoints = Array.isArray(candidate.sellingPoints)
    ? candidate.sellingPoints.map((point) => (typeof point === "string" ? point : "")).slice(0, 3)
    : [];

  if (
    sellingPoints.length !== 3 ||
    typeof candidate.longTitle !== "string" ||
    typeof candidate.shortTitle !== "string"
  ) {
    return EMPTY_PRODUCT_COPY;
  }

  return {
    sellingPoints,
    longTitle: candidate.longTitle,
    shortTitle: candidate.shortTitle
  };
}

function normalizeTaskStatus(input: unknown): EcommerceTaskStatus {
  return input === "queued" ||
    input === "running" ||
    input === "completed" ||
    input === "delivery_failed" ||
    input === "failed"
    ? input
    : "completed";
}

function normalizeImages(input: unknown): EcommerceHistoryImage[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item): EcommerceHistoryImage | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<EcommerceHistoryImage>;
      if (
        typeof candidate.type !== "string" ||
        typeof candidate.label !== "string" ||
        typeof candidate.title !== "string" ||
        typeof candidate.name !== "string" ||
        typeof candidate.prompt !== "string" ||
        typeof candidate.createdAt !== "string"
      ) {
        return null;
      }

      const objectKey = typeof candidate.objectKey === "string" && candidate.objectKey.trim() ? candidate.objectKey : null;
      const imageDataUrl =
        typeof candidate.imageDataUrl === "string"
          ? candidate.imageDataUrl
          : objectKey
            ? ecommerceAssetUrl(objectKey)
          : typeof candidate.cosUrl === "string"
            ? candidate.cosUrl
            : undefined;

      return {
        type: candidate.type,
        label: candidate.label,
        title: candidate.title,
        name: candidate.name,
        imageDataUrl,
        cosUrl: typeof candidate.cosUrl === "string" ? candidate.cosUrl : null,
        objectKey,
        mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : null,
        prompt: candidate.prompt,
        createdAt: candidate.createdAt,
        status: candidate.status === "failed" ? "failed" : "success",
        error: typeof candidate.error === "string" ? candidate.error : undefined,
        cost: candidate.cost ?? null
      };
    })
    .filter((item): item is EcommerceHistoryImage => Boolean(item));
}

function normalizeEcommerceHistory(input: unknown, limit: number): EcommerceHistoryItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  return input
    .map((item): EcommerceHistoryItem | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<EcommerceHistoryItem>;
      const productCopy = normalizeCopy(candidate.productCopy);
      const images = normalizeImages(candidate.images);
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.productTitle !== "string" ||
        typeof candidate.productImageName !== "string" ||
        typeof candidate.textModel !== "string" ||
        typeof candidate.imageModel !== "string" ||
        typeof candidate.imageSize !== "string" ||
        typeof candidate.createdAt !== "string"
      ) {
        return null;
      }

      return {
        id: candidate.id,
        productTitle: candidate.productTitle,
        productImageName: candidate.productImageName,
        productImage: candidate.productImage,
        productCopy,
        textModel: candidate.textModel,
        imageModel: candidate.imageModel,
        imageSize: candidate.imageSize as ImageSize,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        status: normalizeTaskStatus(candidate.status),
        error: typeof candidate.error === "string" ? candidate.error : undefined,
        cost: candidate.cost ?? null,
        userId: candidate.userId ?? null,
        images
      };
    })
    .filter((item): item is EcommerceHistoryItem => {
      if (!item || seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

async function readJsonResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed with status ${response.status}`);
  }
  return body;
}

export async function loadStoredEcommerceHistory(limit: number): Promise<EcommerceHistoryItem[]> {
  const response = await fetch(ecommerceApiUrl(`/api/ecommerce/tasks?limit=${encodeURIComponent(String(limit))}`));
  const body = await readJsonResponse(response);
  return normalizeEcommerceHistory(body.tasks, limit);
}

export async function loadStoredEcommerceTask(taskId: string): Promise<EcommerceHistoryItem> {
  const response = await fetch(ecommerceApiUrl(`/api/ecommerce/tasks/${encodeURIComponent(taskId)}`));
  const body = await readJsonResponse(response);
  const [task] = normalizeEcommerceHistory([body.task], 1);
  if (!task) {
    throw new Error("Ecommerce task response was not valid.");
  }
  return task;
}

export async function createStoredEcommerceTask(input: CreateStoredEcommerceTaskInput): Promise<CreateStoredEcommerceTaskResult> {
  const response = await fetch(ecommerceApiUrl("/api/ecommerce/generate"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const body = await readJsonResponse(response);
  const [task] = normalizeEcommerceHistory([body.task], 1);
  const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : task?.id;
  if (!task || !taskId) {
    throw new Error("Ecommerce task response was not valid.");
  }
  return { taskId, task };
}
