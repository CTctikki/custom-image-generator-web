import { getGenerateTimeoutMs } from "../src/api";
import type { WorkspaceState } from "../src/types";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}

const baseWorkspace: WorkspaceState = {
  theme: "light",
  prompt: "product photo",
  apiKey: "",
  baseUrl: "https://api.lts4ai.com",
  modelName: "gpt-image-2",
  protocol: "openai_images",
  aspectRatio: "1:1",
  imageSize: "2K",
  concurrency: 1,
  promptMode: "count",
  seed: 0,
  seedLocked: false
};

assertEqual(getGenerateTimeoutMs(baseWorkspace), 10 * 60 * 1000, "Standard generation timeout");
assertEqual(getGenerateTimeoutMs({ ...baseWorkspace, imageSize: "4K" }), 30 * 60 * 1000, "4K generation timeout");

console.log("API timeout checks passed.");
