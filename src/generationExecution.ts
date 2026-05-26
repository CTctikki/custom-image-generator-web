export const MAX_PARALLEL_GENERATION_TASKS = 10;

export function resolveGenerationParallelism(totalTasks: number) {
  const taskCount = Number.isFinite(totalTasks) ? Math.trunc(totalTasks) : 0;
  return Math.min(MAX_PARALLEL_GENERATION_TASKS, Math.max(0, taskCount));
}

export async function settleGenerationTasks<TTask, TResult>(
  tasks: TTask[],
  runTask: (task: TTask) => Promise<TResult>
): Promise<PromiseSettledResult<TResult>[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: PromiseSettledResult<TResult>[] = new Array(tasks.length);
  const parallelism = resolveGenerationParallelism(tasks.length);
  let nextTaskIndex = 0;

  async function worker() {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;

      try {
        results[taskIndex] = { status: "fulfilled", value: await runTask(tasks[taskIndex]) };
      } catch (reason) {
        results[taskIndex] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: parallelism }, worker));
  return results;
}
