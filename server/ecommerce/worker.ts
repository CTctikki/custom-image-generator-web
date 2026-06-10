import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createEcommerceTaskRepositoryFromEnv } from "./repository.js";
import { runNextQueuedEcommerceTask } from "./service.js";
import { createObjectStorageFromEnv } from "./storage.js";

function readPositiveInt(name: string, fallback: number, max: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

const concurrency = readPositiveInt("ECOMMERCE_WORKER_CONCURRENCY", 1, 16);
const pollMs = readPositiveInt("ECOMMERCE_WORKER_POLL_MS", 3000, 60_000);
const errorBackoffMs = readPositiveInt("ECOMMERCE_WORKER_ERROR_BACKOFF_MS", 10_000, 300_000);
const staleAfterMs = readPositiveInt("ECOMMERCE_WORKER_STALE_AFTER_MS", 15 * 60 * 1000, 24 * 60 * 60 * 1000);
const repository = createEcommerceTaskRepositoryFromEnv();
const storage = createObjectStorageFromEnv();
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function runWorkerSlot(slot: number) {
  const workerId = `${os.hostname()}-${process.pid}-${slot}`;
  console.log(`[ecommerce-worker] slot ${slot} started as ${workerId}`);

  while (!stopping) {
    try {
      const task = await runNextQueuedEcommerceTask({
        repository,
        storage,
        workerId,
        staleAfterMs
      });

      if (task) {
        console.log(`[ecommerce-worker] ${task.id} -> ${task.status}`);
        continue;
      }

      await delay(pollMs);
    } catch (error) {
      console.error(`[ecommerce-worker] slot ${slot} error`, errorMessage(error));
      await delay(errorBackoffMs);
    }
  }

  console.log(`[ecommerce-worker] slot ${slot} stopped`);
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => runWorkerSlot(index + 1)));
