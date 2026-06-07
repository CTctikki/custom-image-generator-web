import type { ProductCopy } from "./ecommerceGeneration";
import type { ImageSize } from "./types";

export interface EcommerceHistoryImage {
  type: string;
  label: string;
  title: string;
  name: string;
  imageDataUrl: string;
  mimeType: string;
  prompt: string;
  createdAt: string;
}

export interface EcommerceHistoryItem {
  id: string;
  productTitle: string;
  productImageName: string;
  productCopy: ProductCopy;
  textModel: string;
  imageModel: string;
  imageSize: ImageSize;
  createdAt: string;
  images: EcommerceHistoryImage[];
}

const DB_NAME = "custom-image-generator-ecommerce-history";
const DB_VERSION = 1;
const STORE_NAME = "tasks";

function normalizeCopy(input: unknown): ProductCopy | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<ProductCopy>;
  const sellingPoints = Array.isArray(candidate.sellingPoints)
    ? candidate.sellingPoints.map((point) => (typeof point === "string" ? point : "")).slice(0, 3)
    : [];

  if (
    sellingPoints.length !== 3 ||
    sellingPoints.some((point) => point.length === 0) ||
    typeof candidate.longTitle !== "string" ||
    typeof candidate.shortTitle !== "string"
  ) {
    return null;
  }

  return {
    sellingPoints,
    longTitle: candidate.longTitle,
    shortTitle: candidate.shortTitle
  };
}

function normalizeImages(input: unknown): EcommerceHistoryImage[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item): item is EcommerceHistoryImage => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const candidate = item as Partial<EcommerceHistoryImage>;
    return (
      typeof candidate.type === "string" &&
      typeof candidate.label === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.imageDataUrl === "string" &&
      typeof candidate.mimeType === "string" &&
      typeof candidate.prompt === "string" &&
      typeof candidate.createdAt === "string"
    );
  });
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
        !productCopy ||
        images.length === 0 ||
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
        productCopy,
        textModel: candidate.textModel,
        imageModel: candidate.imageModel,
        imageSize: candidate.imageSize as ImageSize,
        createdAt: candidate.createdAt,
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

function openEcommerceHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持 IndexedDB。"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error("电商历史任务库打开失败。"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("电商历史任务库操作失败。"));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = () => reject(transaction.error ?? new Error("电商历史任务库保存失败。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("电商历史任务库保存已取消。"));
    transaction.oncomplete = () => resolve();
  });
}

async function readIndexedEcommerceHistory(db: IDBDatabase, limit: number) {
  const transaction = db.transaction(STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const items = await requestResult<EcommerceHistoryItem[]>(transaction.objectStore(STORE_NAME).getAll());
  await done;
  return normalizeEcommerceHistory(items, limit);
}

async function writeIndexedEcommerceHistory(db: IDBDatabase, history: EcommerceHistoryItem[], limit: number) {
  const items = normalizeEcommerceHistory(history, limit);
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  store.clear();
  for (const item of items) {
    store.put(item);
  }
  await done;
}

export async function loadStoredEcommerceHistory(limit: number): Promise<EcommerceHistoryItem[]> {
  let db: IDBDatabase | null = null;

  try {
    db = await openEcommerceHistoryDb();
    return await readIndexedEcommerceHistory(db, limit);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function saveStoredEcommerceHistory(history: EcommerceHistoryItem[], limit: number): Promise<void> {
  let db: IDBDatabase | null = null;

  try {
    db = await openEcommerceHistoryDb();
    await writeIndexedEcommerceHistory(db, history, limit);
  } finally {
    db?.close();
  }
}
