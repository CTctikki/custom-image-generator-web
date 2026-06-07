# Ecommerce Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `电商生图` tab that generates ecommerce copy and four square ecommerce images from one product image and product title.

**Architecture:** Add a focused `src/ecommerceGeneration.ts` module for copy prompts, image prompts, text API calls, and OpenAI Images edits calls. Keep `src/App.tsx` responsible for tab routing, local page state, rendering, and history insertion. Extend existing contract tests so the feature stays wired to the expected API shape and prompt rules.

**Tech Stack:** Vite, React 19, TypeScript, browser `fetch`, OpenAI-compatible `/v1/chat/completions`, OpenAI Images `/v1/images/edits`, existing local contract scripts.

---

## File Structure

- Create `src/ecommerceGeneration.ts`
  - Owns ecommerce copy types, image type definitions, prompt builders, text API request, text JSON parsing, image edits request, and ecommerce task metadata.
- Create `scripts/check-ecommerce-generation-contract.ts`
  - Imports `src/ecommerceGeneration.ts` and checks defaults, prompt rules, JSON parsing, chat completions URL/body, Images edits FormData, and default `1024x1024` size.
- Modify `scripts/check-ui-contract.mjs`
  - Adds static checks for the `电商生图` tab and key page controls/classes.
- Modify `package.json`
  - Adds `test:ecommerce-generation` and includes it in `npm test`.
- Modify `src/App.tsx`
  - Adds `ActiveView` value `ecommerce`.
  - Imports ecommerce helpers and types.
  - Adds ecommerce page state.
  - Adds handlers for product image upload, copy generation, image generation, and history insertion.
  - Renders the new tab and page.
- Modify `src/styles.css`
  - Adds ecommerce page layout and result card styles using the existing surface, field, button, and panel language.

---

### Task 1: Add Ecommerce Generation Contract Test

**Files:**
- Create: `scripts/check-ecommerce-generation-contract.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the failing ecommerce contract script**

Create `scripts/check-ecommerce-generation-contract.ts`:

```ts
import assert from "node:assert/strict";
import {
  DEFAULT_ECOMMERCE_IMAGE_MODEL,
  DEFAULT_ECOMMERCE_TEXT_MODEL,
  ECOMMERCE_IMAGE_TASKS,
  buildEcommerceImagePrompt,
  buildProductCopyPrompt,
  generateEcommerceImage,
  generateProductCopy,
  parseProductCopyResponse
} from "../src/ecommerceGeneration";
import type { InputImage } from "../src/types";

function assertIncludes(value: string, expected: string, message: string) {
  assert(value.includes(expected), message);
}

const productTitle = "便携手提保温杯女大容量咖啡杯";
const copyPrompt = buildProductCopyPrompt(productTitle);
assertIncludes(copyPrompt, productTitle, "Copy prompt must include the product title.");
assertIncludes(copyPrompt, "JSON", "Copy prompt must require JSON output.");
assertIncludes(copyPrompt, "selling_points", "Copy prompt must require selling_points.");
assertIncludes(copyPrompt, "long_title", "Copy prompt must require long_title.");
assertIncludes(copyPrompt, "short_title", "Copy prompt must require short_title.");

assert.equal(DEFAULT_ECOMMERCE_TEXT_MODEL, "gpt-5.5", "Default text model must be gpt-5.5.");
assert.equal(DEFAULT_ECOMMERCE_IMAGE_MODEL, "gpt-image-2", "Default image model must be gpt-image-2.");
assert.deepEqual(
  ECOMMERCE_IMAGE_TASKS.map((task) => task.type),
  ["main", "scene", "sellingPoints", "whiteBackground"],
  "Ecommerce image task order must match the UI result cards."
);

const parsed = parseProductCopyResponse({
  choices: [
    {
      message: {
        content: JSON.stringify({
          selling_points: ["轻盈便携", "简约百搭", "使用顺手"],
          long_title: "便携大容量保温杯简约通勤咖啡水杯",
          short_title: "通勤便携保温杯"
        })
      }
    }
  ]
});
assert.deepEqual(parsed.sellingPoints, ["轻盈便携", "简约百搭", "使用顺手"]);
assert.equal(parsed.longTitle, "便携大容量保温杯简约通勤咖啡水杯");
assert.equal(parsed.shortTitle, "通勤便携保温杯");

const fenced = parseProductCopyResponse({
  choices: [
    {
      message: {
        content:
          '```json\\n{"selling_points":["细节精致","收纳方便","舒适贴合"],"long_title":"家用收纳盒桌面整理简约置物筐","short_title":"简约桌面收纳盒"}\\n```'
      }
    }
  ]
});
assert.equal(fenced.sellingPoints[0], "细节精致", "Parser must extract JSON from fenced content.");

assert.throws(
  () => parseProductCopyResponse({ choices: [{ message: { content: '{"selling_points":["少"],"long_title":"","short_title":""}' } }] }),
  /文案返回格式不正确/,
  "Parser must reject incomplete JSON."
);

const copy = {
  sellingPoints: ["轻盈便携", "简约百搭", "使用顺手"],
  longTitle: "便携大容量保温杯简约通勤咖啡水杯",
  shortTitle: "通勤便携保温杯"
};

const mainPrompt = buildEcommerceImagePrompt("main", productTitle, copy);
assertIncludes(mainPrompt, "20%-25%", "Main image prompt must reserve the lower-left blank area.");
assertIncludes(mainPrompt, "左下角", "Main image prompt must explicitly mention the lower-left area.");
assertIncludes(mainPrompt, "1:1", "Main image prompt must force square output.");

const scenePrompt = buildEcommerceImagePrompt("scene", productTitle, copy);
assertIncludes(scenePrompt, "不能出现任何文字", "Scene prompt must ban text.");
assertIncludes(scenePrompt, "使用场景", "Scene prompt must infer a usage scene.");
assertIncludes(scenePrompt, "1:1", "Scene prompt must force square output.");

const sellingPointPrompt = buildEcommerceImagePrompt("sellingPoints", productTitle, copy);
assertIncludes(sellingPointPrompt, "卖点文字", "Selling-points prompt must require selling point text.");
assertIncludes(sellingPointPrompt, "轻盈便携", "Selling-points prompt must include generated selling points.");

const whitePrompt = buildEcommerceImagePrompt("whiteBackground", productTitle, copy);
assertIncludes(whitePrompt, "纯白", "White-background prompt must require pure white background.");
assertIncludes(whitePrompt, "不要出现文字", "White-background prompt must ban text.");
assertIncludes(whitePrompt, "1:1", "White-background prompt must force square output.");

const productImage: InputImage = {
  id: "product-1",
  name: "product.png",
  mimeType: "image/png",
  data: "QUJD",
  dataUrl: "data:image/png;base64,QUJD",
  size: 3,
  width: 1000,
  height: 1000
};

let textRequest: { url: string; options: RequestInit } | null = null;
globalThis.fetch = async (url, options = {}) => {
  textRequest = { url: String(url), options };
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              selling_points: ["轻盈便携", "简约百搭", "使用顺手"],
              long_title: "便携大容量保温杯简约通勤咖啡水杯",
              short_title: "通勤便携保温杯"
            })
          }
        }
      ]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

const generatedCopy = await generateProductCopy({
  apiKey: "key",
  baseUrl: "https://api.lts4ai.com",
  model: "gpt-5.5",
  productTitle
});
assert.equal(generatedCopy.shortTitle, "通勤便携保温杯");
assert.equal(textRequest?.url, "https://api.lts4ai.com/v1/chat/completions");
assert.equal((JSON.parse(String(textRequest?.options.body)) as any).model, "gpt-5.5");

let imageRequest: { url: string; options: RequestInit; form: FormData } | null = null;
globalThis.fetch = async (url, options = {}) => {
  const form = options.body as FormData;
  imageRequest = { url: String(url), options, form };
  return new Response(JSON.stringify({ data: [{ b64_json: "QUJD" }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const generatedImage = await generateEcommerceImage({
  apiKey: "key",
  baseUrl: "https://api.lts4ai.com",
  imageModel: "gpt-image-2",
  productImage,
  productTitle,
  copy,
  type: "main"
});
assert.equal(generatedImage.image.dataUrl, "data:image/png;base64,QUJD");
assert.equal(imageRequest?.url, "https://api.lts4ai.com/v1/images/edits");
assert.equal(imageRequest?.form.get("model"), "gpt-image-2");
assert.equal(imageRequest?.form.get("size"), "1024x1024");
assert.equal(imageRequest?.form.get("output_format"), "png");
assert.equal(imageRequest?.form.get("n"), "1");
assert(String(imageRequest?.form.get("prompt")).includes("[电商主图]"));
assert(imageRequest?.form.get("image") instanceof Blob, "Image edits request must include a Blob image.");

console.log("Ecommerce generation contract checks passed.");
```

- [ ] **Step 2: Add the package script**

Modify `package.json` scripts:

```json
{
  "test": "npm run test:ui-contract && npm run test:routing-contract && npm run test:history-storage-contract && npm run test:zip-archive && npm run test:error-copy && npm run test:api-timeout && npm run test:openai-image-size && npm run test:generation-plan && npm run test:generation-execution && npm run test:ecommerce-generation && npm run test:case-library && npm run test:case-library-performance",
  "test:ecommerce-generation": "tsx scripts/check-ecommerce-generation-contract.ts"
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:ecommerce-generation`

Expected: FAIL with an import error that `../src/ecommerceGeneration` cannot be found.

- [ ] **Step 4: Commit the failing test**

```bash
git add package.json scripts/check-ecommerce-generation-contract.ts
git commit -m "test: add ecommerce generation contract"
```

---

### Task 2: Implement Ecommerce Generation Module

**Files:**
- Create: `src/ecommerceGeneration.ts`
- Test: `scripts/check-ecommerce-generation-contract.ts`

- [ ] **Step 1: Add ecommerce generation helpers**

Create `src/ecommerceGeneration.ts`:

```ts
import type { InputImage } from "./types";

interface GeneratedImage {
  data: string;
  mimeType: string;
}

export type EcommerceImageType = "main" | "scene" | "sellingPoints" | "whiteBackground";

export interface EcommerceCopy {
  sellingPoints: [string, string, string];
  longTitle: string;
  shortTitle: string;
}

export interface EcommerceGeneratedImage {
  id: string;
  type: EcommerceImageType;
  label: string;
  prompt: string;
  createdAt: string;
  image: {
    data: string;
    mimeType: string;
    dataUrl: string;
  };
}

export const DEFAULT_ECOMMERCE_TEXT_MODEL = "gpt-5.5";
export const DEFAULT_ECOMMERCE_IMAGE_MODEL = "gpt-image-2";
export const ECOMMERCE_IMAGE_SIZE = "1024x1024";

export const ECOMMERCE_IMAGE_TASKS: Array<{ type: EcommerceImageType; label: string }> = [
  { type: "main", label: "主图" },
  { type: "scene", label: "场景图" },
  { type: "sellingPoints", label: "卖点图" },
  { type: "whiteBackground", label: "白底图" }
];

function normalizeBaseUrl(apiBaseUrl: string) {
  const url = new URL(apiBaseUrl.trim());
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

function requestHeaders(apiKey: string, baseUrl: string, contentType = "application/json") {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const trimmedKey = apiKey.trim();
  if (trimmedKey && baseUrl.includes("generativelanguage.googleapis.com")) {
    headers["x-goog-api-key"] = trimmedKey;
  } else if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

function parseJsonOrEventStream(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const parsed = text
      .split(/\r?\n\r?\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .flatMap((block) => block.split(/\r?\n/))
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, ""))
      .filter((line) => line && line !== "[DONE]")
      .map((line) => JSON.parse(line));
    return parsed.length === 1 ? parsed[0] : parsed;
  }
}

async function readResponseBody(response: Response) {
  return parseJsonOrEventStream(await response.text());
}

function base64ToBlob(data: string, mimeType: string) {
  const binary = atob(data);
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
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
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

  const directB64 = value.b64_json ?? value.b64Json;
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
  collectOpenAiImages(value.image, results);
  collectOpenAiImages(value.images, results);
}

function extractOpenAiImages(raw: any): GeneratedImage[] {
  const results: GeneratedImage[] = [];
  collectOpenAiImages(raw?.stream, results);
  collectOpenAiImages(raw?.choices, results);
  collectOpenAiImages(raw?.data, results);
  collectOpenAiImages(raw?.images, results);
  collectOpenAiImages(raw?.image, results);
  return results;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
  const direct = trimmed.match(/\{[\s\S]*\}/u)?.[0] ?? trimmed;
  return JSON.parse(direct);
}

function toSellingPoints(value: unknown): [string, string, string] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const points = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  if (points.length < 3) {
    return null;
  }
  return [points[0], points[1], points[2]];
}

export function parseProductCopyResponse(raw: any): EcommerceCopy {
  const content =
    raw?.choices?.[0]?.message?.content ??
    raw?.choices?.[0]?.delta?.content ??
    raw?.message?.content ??
    raw?.content ??
    raw;
  const parsed = typeof content === "string" ? extractJsonObject(content) : content;
  const sellingPoints = toSellingPoints(parsed?.selling_points ?? parsed?.sellingPoints);
  const longTitle = typeof parsed?.long_title === "string" ? parsed.long_title.trim() : "";
  const shortTitle = typeof parsed?.short_title === "string" ? parsed.short_title.trim() : "";

  if (!sellingPoints || !longTitle || !shortTitle) {
    throw new Error("文案返回格式不正确，请重新生成文案。");
  }

  return {
    sellingPoints,
    longTitle,
    shortTitle
  };
}

export function buildProductCopyPrompt(productTitle: string) {
  return `你是一名资深电商运营与商品文案策划专家，擅长根据商品标题快速提炼商品核心卖点，并生成适合电商平台使用的高点击标题。

输入商品标题：
${productTitle}

请完成以下任务：
1. 生成 3 个卖点短标题，每个 4-8 个汉字，简洁吸引人，适合用于图片文案。
2. 生成 1 个长标题，24-40 个汉字，适合电商商品上架使用。
3. 生成 1 个短标题，10-18 个汉字，适合卡片展示。
4. 若信息不足，请做合理但保守的推断，不得虚构夸张功能，不得使用违规绝对化表达。

请严格使用 JSON 输出，不要输出解释文字，不要使用 Markdown 代码块：
{
  "selling_points": [
    "卖点1",
    "卖点2",
    "卖点3"
  ],
  "long_title": "长标题",
  "short_title": "短标题"
}`;
}

const COMMON_IMAGE_RULES = `请基于上传的商品参考图生成电商图片。

通用规则：
1. 上传的商品参考图是商品外观的唯一依据，必须严格保留商品本身的颜色、版型、轮廓、材质质感、图案、结构、细节、配件、比例与整体设计，不得擅自改款、改色、增删装饰或改变商品属性。
2. 如果参考图是随手拍，请自动去除杂乱背景、手部、桌面、墙面、反光干扰、阴影杂质等无关元素，只保留商品主体，并优化为专业电商视觉效果。
3. 所有输出图片必须为 1:1 正方形构图。
4. 图片风格需符合电商平台视觉，干净、高级、清晰、吸引点击，商品主体突出。
5. 画面必须高清、细节清楚、边缘自然，适合商品上架使用。
6. 不得添加水印、无关 logo、乱码、无关品牌元素。
7. 除非明确要求加文案，否则图片中不要出现文字。
8. 商品必须完整展示，不能裁掉关键部位，不能让主体过小。`;

function copyBlock(productTitle: string, copy: EcommerceCopy) {
  return `商品标题：
${productTitle}

卖点信息：
1. ${copy.sellingPoints[0]}
2. ${copy.sellingPoints[1]}
3. ${copy.sellingPoints[2]}

长标题：
${copy.longTitle}

短标题：
${copy.shortTitle}`;
}

export function buildEcommerceImagePrompt(type: EcommerceImageType, productTitle: string, copy: EcommerceCopy) {
  const dynamic = copyBlock(productTitle, copy);
  const prompts: Record<EcommerceImageType, string> = {
    main: `[电商主图]
${COMMON_IMAGE_RULES}

请生成一张适合作为电商链接第一张图的主图。
${dynamic}

主图要求：
1. 画面必须突出商品主体，第一眼就能看清商品，商品视觉吸引力强，适合作为电商商品链接的第一张主图。
2. 允许加入简洁、有吸引力的卖点文字，文字优先从以上 3 个卖点中提炼和使用。
3. 画面左下角约 20%-25% 的区域必须保持干净留白，不能出现任何文字、标签、icon、卖点说明、装饰元素或重要主体内容，该区域仅作为后续店铺品牌标签预留位置。
4. 主要文案放在画面上方、右侧或右上区域，避免干扰商品主体。
5. 画面整体风格高级、简洁、干净、偏电商营销风格，具有点击吸引力。
6. 不要添加无关品牌 logo、水印、二维码或杂乱装饰。
7. 输出图片比例必须为 1:1 正方形高清图片。`,
    scene: `[电商场景图]
${COMMON_IMAGE_RULES}

请生成一张高质量电商场景图。
${dynamic}

场景图要求：
1. 根据商品标题与卖点信息，自动推断最合适的商品使用场景，并将商品自然地呈现在对应场景中。
2. 场景必须真实、自然、高级，并能够强化商品卖点和实际使用感。
3. 图片中不能出现任何文字、标题、卖点文案、logo、水印或标签。
4. 商品必须仍然是画面主体，清晰、突出、完整，不能被场景喧宾夺主。
5. 如果卖点更偏舒适、质感、家居使用，则优先营造生活化场景；如果卖点更偏通勤、时尚、搭配，则优先营造穿搭或出行场景；如果卖点更偏功能性、实用性，则优先营造真实使用场景。
6. 输出图片比例必须为 1:1 正方形高清图片。`,
    sellingPoints: `[电商卖点图]
${COMMON_IMAGE_RULES}

请生成一张综合电商卖点图。
${dynamic}

卖点图要求：
1. 图片中必须包含清晰、有吸引力的卖点文字，文字内容优先直接使用以上 3 个卖点。
2. 商品主体清晰突出，并可结合局部特写、细节放大、功能展示或近景展示来强化卖点表达。
3. 卖点文案排版清晰、美观、醒目，适合电商详情页展示。
4. 文字与商品主体之间要有良好视觉层级，不能遮挡商品关键部位。
5. 整体画面高级、专业、简洁，具有电商卖点图的视觉感染力。
6. 输出图片比例必须为 1:1 正方形高清图片。`,
    whiteBackground: `[电商白底图]
${COMMON_IMAGE_RULES}

请生成一张标准电商白底图。
${dynamic}

白底图要求：
1. 背景必须为纯白色，整体画面简洁、干净、专业。
2. 将商品主体从原始背景中干净分离出来，去除所有无关环境元素，仅保留商品。
3. 商品主体居中摆放，完整展示，构图平衡，大小合适。
4. 可保留非常自然、轻微的接地阴影，以增强真实感，但背景整体必须保持标准白底效果。
5. 不要出现文字、logo、水印、标签、边框、贴纸、人物或其他无关物品。
6. 输出图片比例必须为 1:1 正方形高清图片。`
  };

  return prompts[type];
}

export async function generateProductCopy(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  productTitle: string;
}): Promise<EcommerceCopy> {
  const response = await fetch(providerUrl(input.baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: requestHeaders(input.apiKey, input.baseUrl),
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content: buildProductCopyPrompt(input.productTitle) }]
    }),
    signal: AbortSignal.timeout(60_000)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? raw?.message ?? `Provider request failed with status ${response.status}`);
  }

  return parseProductCopyResponse(raw);
}

export async function generateEcommerceImage(input: {
  apiKey: string;
  baseUrl: string;
  imageModel: string;
  productImage: InputImage;
  productTitle: string;
  copy: EcommerceCopy;
  type: EcommerceImageType;
}): Promise<EcommerceGeneratedImage> {
  const task = ECOMMERCE_IMAGE_TASKS.find((item) => item.type === input.type);
  const label = task?.label ?? "电商图";
  const prompt = buildEcommerceImagePrompt(input.type, input.productTitle, input.copy);
  const body = new FormData();
  body.append("model", input.imageModel);
  body.append("prompt", prompt);
  body.append("size", ECOMMERCE_IMAGE_SIZE);
  body.append("n", "1");
  body.append("output_format", "png");
  body.append("image", base64ToBlob(input.productImage.data, input.productImage.mimeType), input.productImage.name || "product.png");

  const response = await fetch(providerUrl(input.baseUrl, "/v1/images/edits"), {
    method: "POST",
    headers: requestHeaders(input.apiKey, input.baseUrl, ""),
    body,
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });

  const raw = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? raw?.message ?? `Provider request failed with status ${response.status}`);
  }

  const image = extractOpenAiImages(raw)[0];
  if (!image) {
    throw new Error("Provider response did not contain any image data.");
  }

  return {
    id: `ecommerce-${input.type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: input.type,
    label,
    prompt,
    createdAt: new Date().toISOString(),
    image: {
      ...image,
      dataUrl: `data:${image.mimeType};base64,${image.data}`
    }
  };
}
```

- [ ] **Step 2: Run the ecommerce contract**

Run: `npm run test:ecommerce-generation`

Expected: PASS with `Ecommerce generation contract checks passed.`

- [ ] **Step 3: Run focused API-adjacent tests**

Run: `npm run test:openai-image-size && npm run test:routing-contract`

Expected: both commands pass.

- [ ] **Step 4: Commit the module**

```bash
git add src/ecommerceGeneration.ts
git commit -m "feat: add ecommerce generation service"
```

---

### Task 3: Add Static UI Contract Coverage

**Files:**
- Modify: `scripts/check-ui-contract.mjs`
- Test: `scripts/check-ui-contract.mjs`

- [ ] **Step 1: Extend UI contract with ecommerce checks**

In `scripts/check-ui-contract.mjs`, add this near the existing `generationTasks` checks:

```js
assert(app.includes('type ActiveView = "studio" | "cases" | "ecommerce";'), "Top-level navigation must include the ecommerce generation view.");
assert(app.includes(">电商生图<"), "Top bar must render the ecommerce generation tab.");
assert(app.includes("DEFAULT_ECOMMERCE_TEXT_MODEL"), "Ecommerce tab must use the default text model constant.");
assert(app.includes("DEFAULT_ECOMMERCE_IMAGE_MODEL"), "Ecommerce tab must use the default image model constant.");
assert(app.includes("runEcommerceGenerate"), "Ecommerce tab must expose the one-click generation flow.");
assert(app.includes("regenerateEcommerceImages"), "Ecommerce copy edits must support regenerating images.");
assert(app.includes("ecommerce-page") && styles.includes(".ecommerce-page"), "Ecommerce tab must have a dedicated page layout.");
assert(app.includes("ecommerce-result-grid") && styles.includes(".ecommerce-result-grid"), "Ecommerce results must render as dedicated result cards.");
assert(ecommerce.includes('DEFAULT_ECOMMERCE_TEXT_MODEL = "gpt-5.5"'), "Ecommerce text model default must be gpt-5.5.");
assert(ecommerce.includes('DEFAULT_ECOMMERCE_IMAGE_MODEL = "gpt-image-2"'), "Ecommerce image model default must be gpt-image-2.");
assert(ecommerce.includes('providerUrl(input.baseUrl, "/v1/chat/completions")'), "Ecommerce copy generation must call chat completions.");
assert(ecommerce.includes('providerUrl(input.baseUrl, "/v1/images/edits")'), "Ecommerce image generation must call image edits.");
```

Also add the `ecommerce` read after the existing `api` read:

```js
const ecommerce = readFileSync(new URL("../src/ecommerceGeneration.ts", import.meta.url), "utf8");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:ui-contract`

Expected: FAIL because `App.tsx` and `styles.css` do not yet contain the ecommerce tab/page wiring.

- [ ] **Step 3: Commit the failing UI contract**

```bash
git add scripts/check-ui-contract.mjs
git commit -m "test: cover ecommerce generation UI contract"
```

---

### Task 4: Wire Ecommerce State and Behaviors in App

**Files:**
- Modify: `src/App.tsx`
- Test: `scripts/check-ui-contract.mjs`, `scripts/check-ecommerce-generation-contract.ts`

- [ ] **Step 1: Add imports and view type**

In `src/App.tsx`, add ecommerce imports after the API import:

```ts
import {
  DEFAULT_ECOMMERCE_IMAGE_MODEL,
  DEFAULT_ECOMMERCE_TEXT_MODEL,
  ECOMMERCE_IMAGE_TASKS,
  generateEcommerceImage,
  generateProductCopy,
  type EcommerceCopy,
  type EcommerceGeneratedImage,
  type EcommerceImageType
} from "./ecommerceGeneration";
```

Change:

```ts
type ActiveView = "studio" | "cases";
```

to:

```ts
type ActiveView = "studio" | "cases" | "ecommerce";
```

- [ ] **Step 2: Add ecommerce component-level types**

Add below `interface GenerationTask`:

```ts
type EcommerceResultStatus = "idle" | "running" | "success" | "failed";

interface EcommerceImageResult {
  type: EcommerceImageType;
  label: string;
  status: EcommerceResultStatus;
  message: string;
  imageDataUrl?: string;
  mimeType?: string;
  prompt?: string;
  createdAt?: string;
  historyId?: string;
}
```

- [ ] **Step 3: Add ecommerce state**

Inside `App`, after existing `generationTasks`/`isGenerating` state, add:

```ts
const [ecommerceProductTitle, setEcommerceProductTitle] = useState("");
const [ecommerceTextModel, setEcommerceTextModel] = useState(DEFAULT_ECOMMERCE_TEXT_MODEL);
const [ecommerceImageModel, setEcommerceImageModel] = useState(DEFAULT_ECOMMERCE_IMAGE_MODEL);
const [ecommerceProductImage, setEcommerceProductImage] = useState<InputImage | null>(null);
const [ecommerceCopy, setEcommerceCopy] = useState<EcommerceCopy>({
  sellingPoints: ["", "", ""],
  longTitle: "",
  shortTitle: ""
});
const [ecommerceResults, setEcommerceResults] = useState<EcommerceImageResult[]>(
  ECOMMERCE_IMAGE_TASKS.map((task) => ({
    type: task.type,
    label: task.label,
    status: "idle",
    message: "待生成"
  }))
);
const [isEcommerceCopyGenerating, setIsEcommerceCopyGenerating] = useState(false);
const [isEcommerceImageGenerating, setIsEcommerceImageGenerating] = useState(false);
const ecommerceFileInputRef = useRef<HTMLInputElement | null>(null);
```

- [ ] **Step 4: Add derived ecommerce booleans**

After `canGenerate`, add:

```ts
const hasEcommerceCopy =
  ecommerceCopy.longTitle.trim().length > 0 &&
  ecommerceCopy.shortTitle.trim().length > 0 &&
  ecommerceCopy.sellingPoints.every((point) => point.trim().length > 0);
const canGenerateEcommerce =
  !isEcommerceCopyGenerating &&
  !isEcommerceImageGenerating &&
  workspace.baseUrl.trim().length > 0 &&
  workspace.apiKey.trim().length > 0 &&
  ecommerceProductTitle.trim().length > 0 &&
  ecommerceTextModel.trim().length > 0 &&
  ecommerceImageModel.trim().length > 0 &&
  ecommerceProductImage !== null;
const canRegenerateEcommerceImages = canGenerateEcommerce && hasEcommerceCopy;
```

Change the existing `isStatusBusy` assignment to include ecommerce activity:

```ts
const isStatusBusy =
  activeView === "cases"
    ? isCaseLibraryLoading
    : activeView === "ecommerce"
      ? isEcommerceCopyGenerating || isEcommerceImageGenerating
      : isGenerating || isLoadingModels;
```

- [ ] **Step 5: Add ecommerce helper handlers**

Add before `runGenerate`:

```ts
const setEcommerceSellingPoint = (index: number, value: string) => {
  setEcommerceCopy((current) => {
    const nextPoints = [...current.sellingPoints] as [string, string, string];
    nextPoints[index] = value;
    return { ...current, sellingPoints: nextPoints };
  });
};

const handleEcommerceFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
  const file = Array.from(event.currentTarget.files ?? []).find((candidate) => candidate.type.startsWith("image/"));
  event.currentTarget.value = "";
  if (!file) {
    setStatusMessage("请选择一张商品图片。");
    return;
  }

  try {
    setEcommerceProductImage(await fileToCompressedInputImage(file));
    setStatusMessage("已载入商品底图。");
  } catch (error) {
    setStatusMessage(compactError(error));
  }
};

const writeEcommerceHistoryItems = (items: EcommerceGeneratedImage[]) => {
  if (items.length === 0 || !ecommerceProductImage) {
    return;
  }

  const historyItems: HistoryItem[] = items.map((item) => ({
    id: item.id,
    imageDataUrl: item.image.dataUrl,
    mimeType: item.image.mimeType,
    prompt: item.prompt,
    modelName: ecommerceImageModel.trim(),
    protocol: "openai_images",
    aspectRatio: "1:1",
    imageSize: "2K",
    inputImageNames: [ecommerceProductImage.name],
    createdAt: item.createdAt
  }));

  setHistory((current) => [...historyItems.reverse(), ...current].slice(0, HISTORY_LIMIT));
  setSelectedHistoryId(historyItems.at(-1)?.id ?? historyItems[0]?.id ?? null);
};
```

- [ ] **Step 6: Add image generation runner**

Add after `writeEcommerceHistoryItems`:

```ts
const runEcommerceImages = async (copy: EcommerceCopy) => {
  if (!ecommerceProductImage) {
    setStatusMessage("请先上传商品底图。");
    return;
  }

  setIsEcommerceImageGenerating(true);
  setEcommerceResults(
    ECOMMERCE_IMAGE_TASKS.map((task) => ({
      type: task.type,
      label: task.label,
      status: "running",
      message: "正在生成"
    }))
  );

  const generatedItems: EcommerceGeneratedImage[] = [];
  const results = await Promise.allSettled(
    ECOMMERCE_IMAGE_TASKS.map(async (task) => {
      const generated = await generateEcommerceImage({
        apiKey: workspace.apiKey,
        baseUrl: workspace.baseUrl,
        imageModel: ecommerceImageModel.trim(),
        productImage: ecommerceProductImage,
        productTitle: ecommerceProductTitle.trim(),
        copy,
        type: task.type
      });
      generatedItems.push(generated);
      setEcommerceResults((current) =>
        current.map((candidate) =>
          candidate.type === task.type
            ? {
                ...candidate,
                status: "success",
                message: "生成完成",
                imageDataUrl: generated.image.dataUrl,
                mimeType: generated.image.mimeType,
                prompt: generated.prompt,
                createdAt: generated.createdAt,
                historyId: generated.id
              }
            : candidate
        )
      );
      return generated;
    })
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const task = ECOMMERCE_IMAGE_TASKS[index];
      const message = compactError(result.reason);
      setEcommerceResults((current) =>
        current.map((candidate) => (candidate.type === task.type ? { ...candidate, status: "failed", message } : candidate))
      );
    }
  });

  writeEcommerceHistoryItems(generatedItems);
  setIsEcommerceImageGenerating(false);

  const failedCount = results.filter((result) => result.status === "rejected").length;
  setStatusMessage(failedCount > 0 ? `电商图生成完成，${failedCount} 张失败。` : "电商图生成完成。");
};
```

- [ ] **Step 7: Add one-click and regeneration handlers**

Add after `runEcommerceImages`:

```ts
const runEcommerceGenerate = async () => {
  if (!canGenerateEcommerce) {
    setStatusMessage("请先配置 Base URL、API Key，并填写商品标题、商品底图和模型。");
    return;
  }

  setIsEcommerceCopyGenerating(true);
  setStatusMessage("正在生成电商文案...");
  try {
    const nextCopy = await generateProductCopy({
      apiKey: workspace.apiKey,
      baseUrl: workspace.baseUrl,
      model: ecommerceTextModel.trim(),
      productTitle: ecommerceProductTitle.trim()
    });
    setEcommerceCopy(nextCopy);
    setStatusMessage("文案生成完成，正在并发生成 4 张电商图...");
    await runEcommerceImages(nextCopy);
  } catch (error) {
    setStatusMessage(compactError(error));
  } finally {
    setIsEcommerceCopyGenerating(false);
  }
};

const regenerateEcommerceCopy = async () => {
  if (!canGenerateEcommerce) {
    setStatusMessage("请先配置 Base URL、API Key，并填写商品标题、商品底图和模型。");
    return;
  }

  setIsEcommerceCopyGenerating(true);
  setStatusMessage("正在重新生成电商文案...");
  try {
    const nextCopy = await generateProductCopy({
      apiKey: workspace.apiKey,
      baseUrl: workspace.baseUrl,
      model: ecommerceTextModel.trim(),
      productTitle: ecommerceProductTitle.trim()
    });
    setEcommerceCopy(nextCopy);
    setStatusMessage("文案已重新生成，可继续编辑或重新生成图片。");
  } catch (error) {
    setStatusMessage(compactError(error));
  } finally {
    setIsEcommerceCopyGenerating(false);
  }
};

const regenerateEcommerceImages = async () => {
  if (!canRegenerateEcommerceImages) {
    setStatusMessage("请先生成或填写完整文案。");
    return;
  }

  await runEcommerceImages({
    sellingPoints: [
      ecommerceCopy.sellingPoints[0].trim(),
      ecommerceCopy.sellingPoints[1].trim(),
      ecommerceCopy.sellingPoints[2].trim()
    ],
    longTitle: ecommerceCopy.longTitle.trim(),
    shortTitle: ecommerceCopy.shortTitle.trim()
  });
};
```

- [ ] **Step 8: Run focused tests to see remaining UI failures**

Run: `npm run test:ecommerce-generation && npm run test:ui-contract`

Expected: ecommerce generation contract passes; UI contract still fails because JSX and styles are not added yet.

---

### Task 5: Render Ecommerce Tab and Page

**Files:**
- Modify: `src/App.tsx`
- Test: `scripts/check-ui-contract.mjs`

- [ ] **Step 1: Add the top navigation tab**

In the `view-tabs` nav, after `案例专区`, add:

```tsx
<button
  className={activeView === "ecommerce" ? "is-active" : ""}
  onClick={() => setActiveView("ecommerce")}
  type="button"
>
  电商生图
</button>
```

- [ ] **Step 2: Render ecommerce page branch**

Find the current transition from the studio branch to the case library branch:

```tsx
) : (
  <main className="case-library-page" aria-label="案例专区">
```

Change only that transition to:

```tsx
) : activeView === "ecommerce" ? (
  <main className="ecommerce-page" aria-label="电商生图">
    <section className="panel ecommerce-input-panel" aria-label="商品输入">
      <div className="section-heading">
        <span>01</span>
        <h2>商品输入</h2>
      </div>
      <input
        accept="image/*"
        className="visually-hidden"
        onChange={(event) => void handleEcommerceFileChange(event)}
        ref={ecommerceFileInputRef}
        type="file"
      />
      <button className={`upload-dropzone ${ecommerceProductImage ? "has-image" : ""}`} onClick={() => ecommerceFileInputRef.current?.click()} type="button">
        {ecommerceProductImage ? (
          <img alt={ecommerceProductImage.name} src={ecommerceProductImage.dataUrl} />
        ) : (
          <div className="empty-upload">
            <UploadCloud size={34} />
            <strong>上传商品底图</strong>
            <span>白底图或随手拍均可</span>
          </div>
        )}
      </button>
      <label className="field">
        <span>商品标题</span>
        <textarea
          onChange={(event) => setEcommerceProductTitle(event.currentTarget.value)}
          placeholder="输入商品标题，例如：便携手提保温杯女大容量咖啡杯"
          value={ecommerceProductTitle}
        />
      </label>
      <div className="field-row compact-setting-row">
        <label className="field">
          <span>文本模型</span>
          <input onChange={(event) => setEcommerceTextModel(event.currentTarget.value)} value={ecommerceTextModel} />
        </label>
        <label className="field">
          <span>图片模型</span>
          <input onChange={(event) => setEcommerceImageModel(event.currentTarget.value)} value={ecommerceImageModel} />
        </label>
      </div>
      <span className="field-hint">复用当前 Base URL 和 API Key。图片固定 2K 正方形。</span>
      <button className="run-button" disabled={!canGenerateEcommerce} onClick={() => void runEcommerceGenerate()} type="button">
        {isEcommerceCopyGenerating || isEcommerceImageGenerating ? <Loader2 className="spin" size={20} /> : <Play size={20} />}
        一键生成
      </button>
    </section>

    <section className="panel ecommerce-copy-panel" aria-label="AI 文案">
      <div className="section-heading">
        <span>02</span>
        <h2>AI 文案</h2>
      </div>
      <label className="field">
        <span>长标题</span>
        <textarea onChange={(event) => setEcommerceCopy((current) => ({ ...current, longTitle: event.currentTarget.value }))} value={ecommerceCopy.longTitle} />
      </label>
      <label className="field">
        <span>短标题</span>
        <input onChange={(event) => setEcommerceCopy((current) => ({ ...current, shortTitle: event.currentTarget.value }))} value={ecommerceCopy.shortTitle} />
      </label>
      <div className="ecommerce-selling-points">
        {ecommerceCopy.sellingPoints.map((point, index) => (
          <label className="field" key={`selling-point-${index}`}>
            <span>卖点 {index + 1}</span>
            <input onChange={(event) => setEcommerceSellingPoint(index, event.currentTarget.value)} value={point} />
          </label>
        ))}
      </div>
      <div className="ecommerce-action-row">
        <button className="text-button" disabled={!canGenerateEcommerce || isEcommerceCopyGenerating} onClick={() => void regenerateEcommerceCopy()} type="button">
          <RefreshCw size={17} />
          重新生成文案
        </button>
        <button className="text-button is-primary" disabled={!canRegenerateEcommerceImages} onClick={() => void regenerateEcommerceImages()} type="button">
          <ImageIcon size={17} />
          重新生成图片
        </button>
      </div>
    </section>

    <section className="panel ecommerce-results-panel" aria-label="电商图片结果">
      <div className="section-heading">
        <span>03</span>
        <h2>图片结果</h2>
      </div>
      <div className="ecommerce-result-grid">
        {ecommerceResults.map((result) => (
          <article className={`ecommerce-result-card is-${result.status}`} key={result.type}>
            <div className="ecommerce-result-head">
              <strong>{result.label}</strong>
              <span>{result.status === "success" ? "已完成" : result.status === "failed" ? "生成失败" : result.status === "running" ? "生成中" : "待生成"}</span>
            </div>
            <div className="ecommerce-result-media">
              {result.imageDataUrl ? (
                <img alt={result.label} src={result.imageDataUrl} />
              ) : result.status === "running" ? (
                <Loader2 className="spin" size={26} />
              ) : result.status === "failed" ? (
                <X size={26} />
              ) : (
                <ImageIcon size={26} />
              )}
            </div>
            <p>{result.message}</p>
            {result.imageDataUrl && result.mimeType && result.createdAt ? (
              <button
                className="text-button"
                onClick={() =>
                  downloadDataUrl({
                    dataUrl: result.imageDataUrl,
                    mimeType: result.mimeType,
                    createdAt: result.createdAt
                  })
                }
                type="button"
              >
                <Download size={16} />
                下载
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  </main>
) : (
  <main className="case-library-page" aria-label="案例专区">
```

Do not change the existing studio branch before this insertion or the existing case library markup after this insertion.

- [ ] **Step 3: Run the UI contract**

Run: `npm run test:ui-contract`

Expected: FAIL only on missing ecommerce CSS classes.

---

### Task 6: Style Ecommerce Page

**Files:**
- Modify: `src/styles.css`
- Test: `scripts/check-ui-contract.mjs`

- [ ] **Step 1: Add ecommerce styles**

Add near the existing panel/layout styles:

```css
.ecommerce-page {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.1fr) minmax(420px, 1.5fr);
  gap: 18px;
  padding: clamp(16px, 2vw, 28px);
}

.ecommerce-input-panel,
.ecommerce-copy-panel,
.ecommerce-results-panel {
  min-width: 0;
}

.ecommerce-input-panel .upload-dropzone {
  min-height: 340px;
}

.ecommerce-copy-panel textarea {
  min-height: 118px;
}

.ecommerce-selling-points {
  display: grid;
  gap: 12px;
}

.ecommerce-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.ecommerce-action-row .is-primary {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-raised));
  color: var(--accent);
}

.ecommerce-result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.ecommerce-result-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-raised);
  padding: 12px;
}

.ecommerce-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ecommerce-result-head strong {
  font-size: 14px;
}

.ecommerce-result-head span,
.ecommerce-result-card p {
  color: var(--muted);
  font-size: 12px;
}

.ecommerce-result-card p {
  margin: 0;
  overflow-wrap: anywhere;
}

.ecommerce-result-media {
  display: grid;
  aspect-ratio: 1 / 1;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--surface) 86%, var(--accent));
}

.ecommerce-result-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fff;
}

.ecommerce-result-card.is-failed {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
  background: color-mix(in srgb, var(--surface-raised) 92%, var(--warn));
}
```

Add responsive styles near the existing `@media (max-width: 1100px)` and `@media (max-width: 760px)` blocks:

```css
@media (max-width: 1200px) {
  .ecommerce-page {
    grid-template-columns: 1fr 1fr;
  }

  .ecommerce-results-panel {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .ecommerce-page {
    grid-template-columns: 1fr;
  }

  .ecommerce-results-panel {
    grid-column: auto;
  }

  .ecommerce-result-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Run UI contract**

Run: `npm run test:ui-contract`

Expected: PASS with `UI contract checks passed.`

- [ ] **Step 3: Run ecommerce contract**

Run: `npm run test:ecommerce-generation`

Expected: PASS with `Ecommerce generation contract checks passed.`

- [ ] **Step 4: Commit UI implementation**

```bash
git add src/App.tsx src/styles.css scripts/check-ui-contract.mjs
git commit -m "feat: add ecommerce generation workspace"
```

---

### Task 7: Full Verification and Local Browser Check

**Files:**
- Modify: no source files expected
- Test: full project verification

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: all contract and TypeScript script checks pass, including `test:ecommerce-generation`.

- [ ] **Step 2: Run production web build**

Run: `npm run build:web`

Expected: Vite build succeeds and emits `dist/`.

- [ ] **Step 3: Start local dev server**

Run: `npm run dev`

Expected: Vite serves the web app at `http://127.0.0.1:5174`.

- [ ] **Step 4: Verify in browser**

Open `http://127.0.0.1:5174` with the Browser plugin. Check:

- Header shows `Image Studio`, `案例专区`, and `电商生图`.
- Clicking `电商生图` shows the upload panel, title input, `gpt-5.5`, `gpt-image-2`, AI copy panel, and four result cards.
- Desktop layout has three usable columns with no overlapping text.
- Mobile viewport stacks panels vertically and result cards remain square.
- With empty required inputs, `一键生成` is disabled or shows the configured missing-input message.

- [ ] **Step 5: Commit verification-only adjustments if needed**

If browser verification reveals layout overflow, make only CSS adjustments in `src/styles.css`, rerun:

```bash
npm run test:ui-contract
npm run build:web
```

Then commit:

```bash
git add src/styles.css
git commit -m "fix: polish ecommerce generation layout"
```

If no adjustments are needed, do not create a commit.

---

## Self-Review

### Spec Coverage

- `电商生图` top Tab: Task 3 and Task 5.
- Shared `Base URL / API Key`: Task 4 uses `workspace.baseUrl` and `workspace.apiKey`.
- Text model default `gpt-5.5`: Task 1, Task 2, Task 4.
- Image model default `gpt-image-2`: Task 1, Task 2, Task 4.
- Text API `/v1/chat/completions`: Task 1 and Task 2.
- Images edits `/v1/images/edits`: Task 1 and Task 2.
- One-click copy then four concurrent images: Task 4.
- Editable copy and image regeneration: Task 4 and Task 5.
- Four image types: Task 1, Task 2, Task 5.
- 2K square `1024x1024`: Task 1 and Task 2.
- History insertion: Task 4.
- Error handling per failed image: Task 4 and Task 5.
- UI consistency and responsive layout: Task 5, Task 6, Task 7.
- Verification commands: Task 7.

### Placeholder Scan

This plan contains no unresolved placeholders. All created files, modified files, commands, expected results, constants, function names, and class names are specified.

### Type Consistency

The plan consistently uses:

- `EcommerceCopy`
- `EcommerceImageType`
- `EcommerceGeneratedImage`
- `EcommerceImageResult`
- `DEFAULT_ECOMMERCE_TEXT_MODEL`
- `DEFAULT_ECOMMERCE_IMAGE_MODEL`
- `ECOMMERCE_IMAGE_TASKS`
- `buildProductCopyPrompt`
- `parseProductCopyResponse`
- `generateProductCopy`
- `buildEcommerceImagePrompt`
- `generateEcommerceImage`
