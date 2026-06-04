import { getGenerateTimeoutMs, resolveProtocolFromModelName } from "../src/api";
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
assertEqual(resolveProtocolFromModelName("gpt-image-2", "gemini_generate_content"), "openai_images", "gpt-image-2 stale protocol fallback");
assertEqual(resolveProtocolFromModelName("dall-e-3", "openai_chat_completions"), "openai_images", "dall-e stale protocol fallback");
assertEqual(
  resolveProtocolFromModelName("gemini-3-pro-image-preview", "gemini_generate_content"),
  "gemini_generate_content",
  "Gemini image models should keep the selected protocol fallback"
);

console.log("API timeout checks passed.");
