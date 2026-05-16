import type { GenerateResponse, InputImage, ProviderModelsResponse, WorkspaceState } from "./types";

export async function fetchProviderModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<ProviderModelsResponse> {
  const response = await fetch("/api/models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      timeoutSeconds: 12
    })
  });

  const payload = (await response.json().catch(() => null)) as ProviderModelsResponse | { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : `获取模型列表失败：${response.status}`);
  }

  return payload as ProviderModelsResponse;
}

export async function generateImage(input: {
  workspace: WorkspaceState;
  inputImages: InputImage[];
  seed: number;
}): Promise<GenerateResponse> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      apiKey: input.workspace.apiKey,
      baseUrl: input.workspace.baseUrl,
      modelName: input.workspace.modelName,
      protocol: input.workspace.protocol,
      prompt: input.workspace.prompt,
      seed: input.seed,
      aspectRatio: input.workspace.aspectRatio,
      imageSize: input.workspace.imageSize,
      timeoutMinutes: 10,
      inputImages: input.inputImages.map((image) => ({
        name: image.name,
        mimeType: image.mimeType,
        data: image.data
      }))
    })
  });

  const payload = (await response.json().catch(() => null)) as GenerateResponse | { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : `生成失败：${response.status}`);
  }

  return payload as GenerateResponse;
}
