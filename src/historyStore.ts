import type { HistoryItem } from "./types";

export const LEGACY_HISTORY_KEY = "custom-image-history-v1";

const DB_NAME = "custom-image-generator-history";
const DB_VERSION = 1;
const STORE_NAME = "items";

function normalizeHistory(input: unknown, limit: number): HistoryItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  return input
    .filter((item): item is HistoryItem => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const candidate = item as Partial<HistoryItem>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.imageDataUrl === "string" &&
        typeof candidate.mimeType === "string" &&
        typeof candidate.prompt === "string" &&
        typeof candidate.modelName === "string" &&
        typeof candidate.protocol === "string" &&
        typeof candidate.aspectRatio === "string" &&
        typeof candidate.imageSize === "string" &&
        Array.isArray(candidate.inputImageNames) &&
        typeof candidate.createdAt === "string"
      );
    })
    .filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

function readLegacyHistory(limit: number) {
  try {
    const raw = localStorage.getItem(LEGACY_HISTORY_KEY);
    return normalizeHistory(raw ? JSON.parse(raw) : [], limit);
  } catch {
    return [];
  }
}

function removeLegacyHistory() {
  try {
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // Ignored: storage may be blocked, but IndexedDB history can still work.
  }
}

function openHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持 IndexedDB。"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error("历史记录数据库打开失败。"));
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
    request.onerror = () => reject(request.error ?? new Error("历史记录操作失败。"));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = () => reject(transaction.error ?? new Error("历史记录保存失败。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("历史记录保存已取消。"));
    transaction.oncomplete = () => resolve();
  });
}

async function readIndexedHistory(db: IDBDatabase, limit: number) {
  const transaction = db.transaction(STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const items = await requestResult<HistoryItem[]>(transaction.objectStore(STORE_NAME).getAll());
  await done;
  return normalizeHistory(items, limit);
}

async function writeIndexedHistory(db: IDBDatabase, history: HistoryItem[], limit: number) {
  const items = normalizeHistory(history, limit);
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  store.clear();
  for (const item of items) {
    store.put(item);
  }
  await done;
}

export async function loadStoredHistory(limit: number): Promise<HistoryItem[]> {
  const legacyHistory = readLegacyHistory(limit);
  let db: IDBDatabase | null = null;

  try {
    db = await openHistoryDb();
    const indexedHistory = await readIndexedHistory(db, limit);
    const mergedHistory = normalizeHistory([...indexedHistory, ...legacyHistory], limit);

    if (legacyHistory.length > 0) {
      await writeIndexedHistory(db, mergedHistory, limit);
      removeLegacyHistory();
    }

    return mergedHistory;
  } catch {
    return legacyHistory;
  } finally {
    db?.close();
  }
}

export async function saveStoredHistory(history: HistoryItem[], limit: number): Promise<void> {
  let db: IDBDatabase | null = null;

  try {
    db = await openHistoryDb();
    await writeIndexedHistory(db, history, limit);
    removeLegacyHistory();
  } finally {
    db?.close();
  }
}
