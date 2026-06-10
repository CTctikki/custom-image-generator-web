import { createEcommerceTask, getEcommerceTask, listEcommerceTasks, scheduleEcommerceTask } from "./service.js";
import type { CreateEcommerceTaskInput, EcommerceServiceDependencies, EcommerceTaskRecord } from "./types.js";

export interface EcommerceJsonResponse {
  status: number;
  body: unknown;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ecommerce request failed.";
}

function parseLimit(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" || typeof raw === "number" ? Number.parseInt(String(raw), 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 30;
}

export async function handleCreateEcommerceTaskRequest(
  body: unknown,
  deps: EcommerceServiceDependencies = {}
): Promise<EcommerceJsonResponse> {
  try {
    const input = body as CreateEcommerceTaskInput;
    const task = await createEcommerceTask(input, deps);
    scheduleEcommerceTask(task.id, input, deps);
    return {
      status: 202,
      body: { taskId: task.id, task }
    };
  } catch (error) {
    return {
      status: 400,
      body: { error: errorMessage(error) }
    };
  }
}

export async function handleGetEcommerceTaskRequest(
  query: Record<string, unknown>,
  deps: Partial<Pick<EcommerceServiceDependencies, "repository">> = {}
): Promise<EcommerceJsonResponse> {
  try {
    const rawId = Array.isArray(query.id) ? query.id[0] : query.id;
    const id = typeof rawId === "string" ? rawId.trim() : "";
    const task = await getEcommerceTask(id, {
      ...deps,
      userId: typeof query.userId === "string" && query.userId.trim() ? query.userId.trim() : null
    });
    return task
      ? {
          status: 200,
          body: { task }
        }
      : {
          status: 404,
          body: { error: "Ecommerce task was not found.", task: null as EcommerceTaskRecord | null }
        };
  } catch (error) {
    return {
      status: 400,
      body: { error: errorMessage(error), task: null as EcommerceTaskRecord | null }
    };
  }
}

export async function handleListEcommerceTasksRequest(
  query: Record<string, unknown>,
  deps: Partial<Pick<EcommerceServiceDependencies, "repository">> = {}
): Promise<EcommerceJsonResponse> {
  try {
    const tasks = await listEcommerceTasks(
      {
        limit: parseLimit(query.limit),
        userId: typeof query.userId === "string" && query.userId.trim() ? query.userId.trim() : null
      },
      deps
    );
    return {
      status: 200,
      body: { tasks }
    };
  } catch (error) {
    return {
      status: 400,
      body: { error: errorMessage(error), tasks: [] as EcommerceTaskRecord[] }
    };
  }
}
