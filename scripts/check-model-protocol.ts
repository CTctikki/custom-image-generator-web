import { fetchProviderModels } from "../src/api";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async (input) => {
    const url = input.toString();
    if (url.endsWith("/v1beta/models")) {
      return jsonResponse({ error: { message: "unauthorized" } }, 401);
    }
    if (url.endsWith("/v1/models")) {
      return jsonResponse({
        data: [{ id: "gemini-3.1-flash-image" }, { id: "gpt-image-2" }, { id: "gpt-5.4-mini" }]
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const openAiModels = await fetchProviderModels({
    baseUrl: "https://api.lts4ai.com",
    apiKey: "sk-test"
  });

  assertEqual(
    openAiModels.models.find((model) => model.id === "gemini-3.1-flash-image")?.protocol,
    "openai_images",
    "OpenAI-compatible Gemini image models should use Images API"
  );
  assertEqual(openAiModels.models[0]?.id, "gpt-image-2", "Image2 should be the default model option");

  globalThis.fetch = async (input) => {
    const url = input.toString();
    if (url.endsWith("/v1beta/models")) {
      return jsonResponse({
        models: [{ name: "models/gemini-3.1-flash-image" }]
      });
    }
    if (url.endsWith("/v1/models")) {
      return jsonResponse({ data: [] });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const geminiModels = await fetchProviderModels({
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "google-test"
  });

  assertEqual(
    geminiModels.models.find((model) => model.id === "gemini-3.1-flash-image")?.protocol,
    "gemini_generate_content",
    "Native Gemini model list should keep the Gemini generateContent protocol"
  );

  console.log("Model protocol checks passed.");
} finally {
  globalThis.fetch = originalFetch;
}
