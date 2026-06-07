import { settleGenerationTasks } from "./generationExecution";
import type { InputImage } from "./types";

interface GeneratedImage {
  data: string;
  mimeType: string;
}

export type EcommerceImageTaskType = "main" | "scene" | "sellingPoints" | "whiteBackground";
export type EcommerceImageType = EcommerceImageTaskType;

export interface ProductCopy {
  sellingPoints: string[];
  longTitle: string;
  shortTitle: string;
}

export type EcommerceCopy = ProductCopy;

export interface EcommerceImageTask {
  type: EcommerceImageTaskType;
  label: string;
  title: string;
  name: string;
}

export interface EcommerceGeneratedImage {
  id: string;
  type: EcommerceImageTaskType;
  label: string;
  title: string;
  name: string;
  prompt: string;
  createdAt: string;
  image: {
    data: string;
    mimeType: string;
    dataUrl: string;
  };
}

export interface GenerateProductCopyInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  productTitle: string;
}

export interface GenerateEcommerceImageInput {
  apiKey: string;
  baseUrl: string;
  imageModel: string;
  productImage: InputImage;
  productTitle: string;
  copy: ProductCopy;
  type: EcommerceImageTaskType;
}

export type GenerateEcommerceImagesInput = Omit<GenerateEcommerceImageInput, "type">;

export type EcommerceImageGenerationResult =
  | {
      type: EcommerceImageTaskType;
      label: string;
      title: string;
      name: string;
      status: "success";
      image: EcommerceGeneratedImage;
    }
  | {
      type: EcommerceImageTaskType;
      label: string;
      title: string;
      name: string;
      status: "failed";
      error: string;
    };

export const DEFAULT_ECOMMERCE_TEXT_MODEL = "gpt-5.5";
export const DEFAULT_ECOMMERCE_IMAGE_MODEL = "gpt-image-2";
export const ECOMMERCE_IMAGE_SIZE = "1024x1024";

export const ECOMMERCE_IMAGE_TASKS: EcommerceImageTask[] = [
  { type: "main", label: "主图", title: "电商主图", name: "main" },
  { type: "scene", label: "场景图", title: "电商场景图", name: "scene" },
  { type: "sellingPoints", label: "卖点图", title: "电商卖点图", name: "selling-points" },
  { type: "whiteBackground", label: "白底图", title: "电商白底图", name: "white-background" }
];

const COPY_FORMAT_ERROR = "文案返回格式不正确，请重新生成文案。";

function normalizeBaseUrl(apiBaseUrl: string) {
  const trimmedBaseUrl = apiBaseUrl.trim();
  if (!trimmedBaseUrl) {
    throw new Error("Base URL 不能为空。");
  }

  const url = new URL(trimmedBaseUrl);
  let pathname = url.pathname.replace(/\/+$/, "");
  ["/v1/chat/completions", "/v1/images/edits", "/v1/images/generations", "/v1/models", "/v1beta/models"].forEach(
    (suffix) => {
      if (pathname.endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length);
      }
    }
  );
  if (pathname === "/v1") {
    pathname = "";
  }
  url.pathname = pathname || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function providerUrl(apiBaseUrl: string, path: string) {
  return new URL(`${normalizeBaseUrl(apiBaseUrl)}${path}`).toString();
}

function requestHeaders(apiKey: string, _baseUrl: string, contentType = "application/json") {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const trimmedKey = apiKey.trim();
  if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

function parseEventStreamJson(text: string): unknown[] {
  const results: unknown[] = [];
  text
    .split(/\r?\n\r?\n/u)
    .map((block) =>
      block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/u, ""))
        .join("\n")
        .trim()
    )
    .filter((data) => data && data !== "[DONE]")
    .forEach((data) => {
      results.push(JSON.parse(data));
    });
  return results;
}

function parseJsonOrEventStream(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      const stream = parseEventStreamJson(trimmed);
      if (stream.length > 0) {
        return stream.length === 1 ? stream[0] : { stream };
      }
    } catch {
      return { message: trimmed.slice(0, 240) };
    }
    return { message: trimmed.slice(0, 240) };
  }
}

async function readResponseBody(response: Response) {
  return parseJsonOrEventStream(await response.text());
}

function timeoutSignal(timeoutMs: number) {
  return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
}

function base64ToBlob(data: string, mimeType: string) {
  const cleanData = data.includes(",") ? data.split(",").at(-1) ?? data : data;
  const binary = atob(cleanData);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function parseDataUrl(value: unknown): GeneratedImage | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/^data:([^;,]+);base64,(.+)$/u);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

function collectOpenAiImages(value: any, results: GeneratedImage[]) {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) {
    results.push(dataUrl);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectOpenAiImages(item, results));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const directB64 = value.b64_json ?? value.b64Json ?? value.image_base64 ?? value.imageBase64 ?? value.base64;
  if (typeof directB64 === "string" && directB64.trim()) {
    results.push({
      data: directB64.trim(),
      mimeType: value.mime_type ?? value.mimeType ?? "image/png"
    });
  }

  collectOpenAiImages(value.image_url?.url, results);
  collectOpenAiImages(value.url, results);
  collectOpenAiImages(value.content, results);
  collectOpenAiImages(value.delta, results);
  collectOpenAiImages(value.message, results);
  collectOpenAiImages(value.output, results);
  collectOpenAiImages(value.response, results);
  collectOpenAiImages(value.image, results);
  collectOpenAiImages(value.images, results);
  collectOpenAiImages(value.choices, results);
}

function extractOpenAiImages(raw: any): GeneratedImage[] {
  const results: GeneratedImage[] = [];
  collectOpenAiImages(raw?.stream, results);
  collectOpenAiImages(raw?.choices, results);
  collectOpenAiImages(raw?.data, results);
  collectOpenAiImages(raw?.images, results);
  collectOpenAiImages(raw?.image, results);
  collectOpenAiImages(raw?.output, results);
  return results;
}

function extractMessage(errorBody: any, fallback: string) {
  return (
    errorBody?.error?.message ??
    errorBody?.message ??
    errorBody?.choices?.[0]?.message?.content ??
    errorBody?.choices?.[0]?.text ??
    fallback
  );
}

function contentToText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return typeof record.text === "string" ? record.text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractCopyContent(raw: any): unknown {
  return (
    raw?.choices?.[0]?.message?.content ??
    raw?.choices?.[0]?.delta?.content ??
    raw?.choices?.[0]?.text ??
    raw?.message?.content ??
    raw?.content ??
    raw
  );
}

function extractBalancedJsonObject(text: string) {
  const start = text.indexOf("{");
  if (start < 0) {
    return text;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return text.slice(start);
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const source = fenced?.[1] ?? text;
  return JSON.parse(extractBalancedJsonObject(source.trim()));
}

function toSellingPoints(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const points = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  if (points.length < 3) {
    return null;
  }
  return points.slice(0, 3);
}

export function parseProductCopyResponse(raw: unknown): ProductCopy {
  let parsed: any;
  const content = extractCopyContent(raw);

  try {
    const text = contentToText(content);
    parsed = text ? extractJsonObject(text) : content;
  } catch {
    throw new Error(COPY_FORMAT_ERROR);
  }

  const sellingPoints = toSellingPoints(parsed?.selling_points ?? parsed?.sellingPoints);
  const longTitle = typeof (parsed?.long_title ?? parsed?.longTitle) === "string" ? (parsed.long_title ?? parsed.longTitle).trim() : "";
  const shortTitle =
    typeof (parsed?.short_title ?? parsed?.shortTitle) === "string" ? (parsed.short_title ?? parsed.shortTitle).trim() : "";

  if (!sellingPoints || !longTitle || !shortTitle) {
    throw new Error(COPY_FORMAT_ERROR);
  }

  return {
    sellingPoints,
    longTitle,
    shortTitle
  };
}

export function buildProductCopyPrompt(productTitle: string): string {
  return `你是一名资深电商运营和商品文案策划。请根据商品标题提炼适合电商图片和上架页使用的卖点文案。

商品标题：${productTitle}

请只返回严格 JSON，不要输出解释文字，不要使用 Markdown。JSON 字段必须包含：
- selling_points：正好 3 个短卖点，每个 4-10 个汉字，适合直接放在商品图上。
- long_title：1 个电商长标题，适合商品上架使用。
- short_title：1 个短标题，适合结果卡片或图片主标题使用。

返回格式示例：
{
  "selling_points": ["卖点1", "卖点2", "卖点3"],
  "long_title": "适合电商上架的长标题",
  "short_title": "短标题"
}

要求：卖点要清晰可信，避免绝对化、医疗化或无法从商品标题合理推断的夸张承诺。`;
}

function copyBlock(productTitle: string, copy: ProductCopy) {
  return `商品标题：${productTitle}

卖点信息：
1. ${copy.sellingPoints[0] ?? ""}
2. ${copy.sellingPoints[1] ?? ""}
3. ${copy.sellingPoints[2] ?? ""}

长标题：${copy.longTitle}
短标题：${copy.shortTitle}`;
}

const COMMON_IMAGE_RULES = `通用规则：
- 参考图是商品外观的唯一依据，必须严格保留商品颜色、版型、轮廓、材质、图案、结构、细节、配件、比例和整体设计。
- 如果参考图是随手拍，请移除杂乱背景、手部、桌面、墙面、反光、阴影杂质等无关元素，只保留商品主体并优化为专业电商视觉。
- 输出必须为 1:1 正方形构图，画面干净、高级、清晰，商品主体突出。
- 不添加水印、无关 logo、二维码、乱码、无关品牌元素或误导性标签。
- 商品必须完整展示，不裁切关键部位，不让主体过小。`;

export function buildEcommerceImagePrompt(type: EcommerceImageTaskType, productTitle: string, copy: ProductCopy): string {
  const dynamic = copyBlock(productTitle, copy);
  const prompts: Record<EcommerceImageTaskType, string> = {
    main: `[电商主图]
${COMMON_IMAGE_RULES}

${dynamic}

主图要求：
- 作为电商链接第一张图，第一眼就能看清商品，整体有点击吸引力。
- 可以加入简洁醒目的卖点文字，优先使用以上三个卖点，但不要遮挡商品关键部位。
- 商品主体必须完整突出、清晰可见，比例自然醒目，不裁切关键部位。
- 左下角约 20%-25% 区域必须保持干净留白，左下角不放文字、标签、icon、卖点说明、装饰元素或重要主体内容。
- 主要文案建议放在画面上方、右侧或右上区域。
- 输出比例必须为 1:1。`,
    scene: `[电商场景图]
${COMMON_IMAGE_RULES}

${dynamic}

场景图要求：
- 根据商品标题和三个卖点推断真实、自然、高级的使用场景，让商品自然处在最合适的使用场景中。
- 商品仍然是画面主体，清晰、突出、完整，不被场景喧宾夺主。
- 不能出现任何文字、标题、卖点文案、logo、水印、标签或可读字符。
- 场景要强化商品卖点和实际使用感。
- 输出比例必须为 1:1。`,
    sellingPoints: `[电商卖点图]
${COMMON_IMAGE_RULES}

${dynamic}

卖点图要求：
- 图片中必须包含清晰、有吸引力的卖点文字，卖点文字优先直接使用以下三个卖点：${copy.sellingPoints.join("、")}。
- 三个卖点都要在画面中有明确呈现，排版清楚、美观、醒目。
- 可以结合局部特写、细节放大、功能示意或近景展示来强化卖点表达。
- 文字不能遮挡商品关键部位，商品主体仍需清晰突出。
- 输出比例必须为 1:1。`,
    whiteBackground: `[电商白底图]
${COMMON_IMAGE_RULES}

${dynamic}

白底图要求：
- 生成标准电商白底图，背景必须纯白、干净、专业。
- 商品主体居中摆放，完整展示，构图平衡，大小合适。
- 可以保留非常自然、轻微的接地阴影，但背景整体必须保持纯白。
- 不要出现文字、logo、水印、标签、边框、贴纸、人物或其他无关物品。
- 输出比例必须为 1:1。`
  };

  return prompts[type];
}

export async function generateProductCopy(input: GenerateProductCopyInput): Promise<ProductCopy> {
  const response = await fetch(providerUrl(input.baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: requestHeaders(input.apiKey, input.baseUrl),
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "user",
          content: buildProductCopyPrompt(input.productTitle)
        }
      ]
    }),
    signal: timeoutSignal(60_000)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(extractMessage(raw, `Provider request failed with status ${response.status}`));
  }

  return parseProductCopyResponse(raw);
}

export async function generateEcommerceImage(input: GenerateEcommerceImageInput): Promise<EcommerceGeneratedImage> {
  const task = ECOMMERCE_IMAGE_TASKS.find((item) => item.type === input.type);
  if (!task) {
    throw new Error(`未知的电商图片类型：${input.type}`);
  }

  const prompt = buildEcommerceImagePrompt(input.type, input.productTitle, input.copy);
  const body = new FormData();
  body.append("model", input.imageModel);
  body.append("prompt", prompt);
  body.append("size", ECOMMERCE_IMAGE_SIZE);
  body.append("output_format", "png");
  body.append("n", "1");
  body.append("image", base64ToBlob(input.productImage.data, input.productImage.mimeType), input.productImage.name || "product.png");

  const response = await fetch(providerUrl(input.baseUrl, "/v1/images/edits"), {
    method: "POST",
    headers: requestHeaders(input.apiKey, input.baseUrl, ""),
    body,
    signal: timeoutSignal(10 * 60 * 1000)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(extractMessage(raw, `Provider request failed with status ${response.status}`));
  }

  const image = extractOpenAiImages(raw)[0];
  if (!image) {
    throw new Error("图片返回格式不正确：响应中没有可用的图片数据。");
  }

  return {
    id: `ecommerce-${input.type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: input.type,
    label: task.label,
    title: task.title,
    name: task.name,
    prompt,
    createdAt: new Date().toISOString(),
    image: {
      ...image,
      dataUrl: `data:${image.mimeType};base64,${image.data}`
    }
  };
}

export async function generateEcommerceImages(input: GenerateEcommerceImagesInput): Promise<EcommerceImageGenerationResult[]> {
  const settled = await settleGenerationTasks(
    ECOMMERCE_IMAGE_TASKS,
    (task) =>
      generateEcommerceImage({
        ...input,
        type: task.type
      }),
    { maxAttempts: 2, retryDelayMs: 800 }
  );

  return settled.map((result, index) => {
    const task = ECOMMERCE_IMAGE_TASKS[index];
    if (result.status === "fulfilled") {
      return {
        type: task.type,
        label: task.label,
        title: task.title,
        name: task.name,
        status: "success",
        image: result.value
      };
    }

    return {
      type: task.type,
      label: task.label,
      title: task.title,
      name: task.name,
      status: "failed",
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    };
  });
}
