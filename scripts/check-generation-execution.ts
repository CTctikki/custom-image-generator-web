import { resolveGenerationParallelism, settleGenerationTasks } from "../src/generationExecution";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}

function assertArrayEqual<T>(actual: T[], expected: T[], message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}.`);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

assertEqual(resolveGenerationParallelism(0), 0, "Empty batches should not start workers");
assertEqual(resolveGenerationParallelism(3), 3, "Parallelism should match task count");
assertEqual(resolveGenerationParallelism(12), 10, "Parallelism should never exceed ten tasks");

const started: number[] = [];
const controls = Array.from({ length: 12 }, () => deferred<string>());

const pending = settleGenerationTasks(Array.from({ length: 12 }, (_, index) => index + 1), async (task) => {
  started.push(task);
  return controls[task - 1].promise;
});

await flushMicrotasks();
assertArrayEqual(started, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "Execution should start every task immediately up to ten");

controls[0].resolve("first");
await flushMicrotasks();
assertArrayEqual(started, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], "Execution should start the next task as soon as a slot frees");

controls[1].resolve("second");
controls.slice(2, 11).forEach((control, index) => control.resolve(`task-${index + 3}`));
await flushMicrotasks();
assertArrayEqual(started, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "Execution should keep filling open slots");

controls[11].reject(new Error("twelfth failed"));

const settled = await pending;
assertArrayEqual(
  settled.map((result) => result.status),
  ["fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "fulfilled", "rejected"],
  "Execution should preserve result order"
);

const retriedAttempts: number[] = [];
const retried = await settleGenerationTasks(
  [1],
  async (task) => {
    retriedAttempts.push(task);
    if (retriedAttempts.length === 1) {
      throw new Error("temporary upstream failure");
    }
    return "recovered";
  },
  { maxAttempts: 2, retryDelayMs: 0 }
);

assertArrayEqual(retriedAttempts, [1, 1], "Execution should retry a failed task when retry attempts are configured");
assertArrayEqual(retried.map((result) => result.status), ["fulfilled"], "Retried task should settle with its recovered result");

let skippedRetryAttempts = 0;
const skippedRetry = await settleGenerationTasks(
  [1],
  async () => {
    skippedRetryAttempts += 1;
    throw new Error("permanent failure");
  },
  { maxAttempts: 3, retryDelayMs: 0, shouldRetry: () => false }
);

assertEqual(skippedRetryAttempts, 1, "Execution should honor shouldRetry=false without extra attempts");
assertArrayEqual(skippedRetry.map((result) => result.status), ["rejected"], "Permanent failures should remain rejected");

console.log("Generation execution checks passed.");
