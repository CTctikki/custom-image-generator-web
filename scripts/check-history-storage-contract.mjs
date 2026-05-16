import { existsSync, readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const historyStoreUrl = new URL("../src/historyStore.ts", import.meta.url);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(existsSync(historyStoreUrl), "History storage must live in src/historyStore.ts.");

const historyStore = readFileSync(historyStoreUrl, "utf8");

assert(historyStore.includes("indexedDB"), "Generated image history must be stored with IndexedDB.");
assert(historyStore.includes("custom-image-generator-history"), "IndexedDB database name must be explicit and stable.");
assert(historyStore.includes("custom-image-history-v1"), "Legacy localStorage history key must be migrated.");
assert(historyStore.includes("localStorage.removeItem(LEGACY_HISTORY_KEY)"), "Legacy localStorage history should be removed after migration.");

assert(app.includes("loadStoredHistory"), "App must load image history from the IndexedDB history store.");
assert(app.includes("saveStoredHistory"), "App must persist image history through the IndexedDB history store.");
assert(!app.includes("localStorage.setItem(HISTORY_KEY"), "App must not save generated image history to localStorage.");
assert(!app.includes("const HISTORY_KEY"), "App must not keep the generated image history localStorage key.");

console.log("History storage contract checks passed.");
