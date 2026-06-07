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

const productTitle = "山茶花补水面霜";
const productCopy = {
  sellingPoints: ["密集补水", "清爽不粘腻", "修护干燥泛红"],
  longTitle: "山茶花补水面霜女保湿修护滋润不粘腻日夜可用护肤礼盒",
  shortTitle: "山茶花补水面霜"
};

function assertIncludes(value: string, expected: string, message: string) {
  assert.ok(value.includes(expected), `${message}: expected "${value}" to include "${expected}".`);
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  return String(input);
}

function requestHeader(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], name: string) {
  const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  if (!headers) {
    return null;
  }

  const normalizedName = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === normalizedName);
    return match?.[1] ?? null;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return String(value);
    }
  }
  return null;
}

function requestPromptText(body: any) {
  const chunks: string[] = [];

  function collect(value: unknown): void {
    if (typeof value === "string") {
      chunks.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    collect(record.content);
    collect(record.text);
    collect(record.prompt);
    collect(record.message);
    collect(record.messages);
  }

  collect(body.messages);
  collect(body.prompt);
  collect(body.message);
  return chunks.join("\n");
}

async function withMockedFetch<T>(
  mockFetch: typeof fetch,
  run: () => Promise<T>
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const productCopyPrompt = buildProductCopyPrompt(productTitle);
assertIncludes(productCopyPrompt, productTitle, "Product copy prompt should include the product title");
assertIncludes(productCopyPrompt, "JSON", "Product copy prompt should request JSON");
assertIncludes(productCopyPrompt, "selling_points", "Product copy prompt should request selling points");
assertIncludes(productCopyPrompt, "long_title", "Product copy prompt should request a long title");
assertIncludes(productCopyPrompt, "short_title", "Product copy prompt should request a short title");

assert.equal(DEFAULT_ECOMMERCE_TEXT_MODEL, "gpt-5.5");
assert.equal(DEFAULT_ECOMMERCE_IMAGE_MODEL, "gpt-image-2");
assert.deepEqual(
  ECOMMERCE_IMAGE_TASKS.map((task) => task.type),
  ["main", "scene", "sellingPoints", "whiteBackground"]
);

const chatChoicesResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          selling_points: productCopy.sellingPoints,
          long_title: productCopy.longTitle,
          short_title: productCopy.shortTitle
        })
      }
    }
  ]
};
assert.deepEqual(parseProductCopyResponse(chatChoicesResponse), productCopy);

const fencedResponse = {
  choices: [
    {
      message: {
        content: `下面是生成结果：\n\`\`\`json\n${JSON.stringify({
          selling_points: productCopy.sellingPoints,
          long_title: productCopy.longTitle,
          short_title: productCopy.shortTitle
        })}\n\`\`\``
      }
    }
  ]
};
assert.deepEqual(parseProductCopyResponse(fencedResponse), productCopy);

assert.throws(
  () =>
    parseProductCopyResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              selling_points: ["密集补水"],
              long_title: productCopy.longTitle
            })
          }
        }
      ]
    }),
  /文案返回格式不正确/
);

const mainPrompt = buildEcommerceImagePrompt("main", productTitle, productCopy);
assertIncludes(mainPrompt, "20%-25%", "Main image prompt should reserve the lower-left blank area");
assertIncludes(mainPrompt, "左下角", "Main image prompt should mention the lower-left area");
assertIncludes(mainPrompt, "留白", "Main image prompt should describe the lower-left area as blank space");
assert.doesNotMatch(
  mainPrompt,
  /(商品主体|主体).{0,12}(占比|比例).{0,12}20%-25%|20%-25%.{0,12}(商品主体|主体).{0,12}(占比|比例)/u,
  "Main image prompt must not describe 20%-25% as the product scale"
);
assertIncludes(mainPrompt, "1:1", "Main image prompt should require square output");

const scenePrompt = buildEcommerceImagePrompt("scene", productTitle, productCopy);
assertIncludes(scenePrompt, "不能出现任何文字", "Scene image prompt should forbid text");
assertIncludes(scenePrompt, "使用场景", "Scene image prompt should describe the usage scene");
assertIncludes(scenePrompt, "1:1", "Scene image prompt should require square output");

const sellingPointsPrompt = buildEcommerceImagePrompt("sellingPoints", productTitle, productCopy);
assertIncludes(sellingPointsPrompt, "卖点文字", "Selling points prompt should request selling point copy");
assertIncludes(sellingPointsPrompt, productCopy.sellingPoints[0], "Selling points prompt should include generated selling points");

const whiteBackgroundPrompt = buildEcommerceImagePrompt("whiteBackground", productTitle, productCopy);
assertIncludes(whiteBackgroundPrompt, "纯白", "White background prompt should require a pure white background");
assertIncludes(whiteBackgroundPrompt, "不要出现文字", "White background prompt should forbid text");
assertIncludes(whiteBackgroundPrompt, "1:1", "White background prompt should require square output");

const generatedCopy = await withMockedFetch(
  (async (input, init) => {
    assert.equal(requestUrl(input), "https://api.lts4ai.com/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(requestHeader(input, init, "Authorization"), "Bearer key");
    assert.equal(typeof init?.body, "string", "Product copy request body should be JSON.");
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, "gpt-5.5");
    const promptText = requestPromptText(body);
    assertIncludes(promptText, productTitle, "Product copy request prompt should include the product title");
    assertIncludes(promptText, "JSON", "Product copy request prompt should clearly require JSON");
    assertIncludes(promptText, "selling_points", "Product copy request prompt should require selling_points");
    assertIncludes(promptText, "long_title", "Product copy request prompt should require long_title");
    assertIncludes(promptText, "short_title", "Product copy request prompt should require short_title");

    return jsonResponse(chatChoicesResponse);
  }) as typeof fetch,
  () =>
    generateProductCopy({
      apiKey: "key",
      baseUrl: "https://api.lts4ai.com",
      model: "gpt-5.5",
      productTitle
    })
);
assert.deepEqual(generatedCopy, productCopy);

const sourceImage: InputImage = {
  id: "source-image",
  name: "source.png",
  mimeType: "image/png",
  data: "QUJD",
  dataUrl: "data:image/png;base64,QUJD",
  size: 3,
  width: 1024,
  height: 1024
};

const generatedImage = await withMockedFetch(
  (async (input, init) => {
    assert.equal(requestUrl(input), "https://api.lts4ai.com/v1/images/edits");
    assert.equal(init?.method, "POST");
    assert.equal(requestHeader(input, init, "Authorization"), "Bearer key");
    assert.ok(init?.body instanceof FormData, "Ecommerce image request body should be FormData.");

    const formData = init.body as FormData;
    assert.equal(formData.get("model"), "gpt-image-2");
    assert.equal(formData.get("size"), "1024x1024");
    assert.equal(formData.get("output_format"), "png");
    assert.equal(formData.get("n"), "1");
    const prompt = formData.get("prompt");
    assert.equal(typeof prompt, "string");
    assertIncludes(prompt, "[电商主图]", "Main ecommerce image prompt");
    assertIncludes(prompt, productTitle, "Main ecommerce image prompt should include the product title");
    productCopy.sellingPoints.forEach((sellingPoint) => {
      assertIncludes(prompt, sellingPoint, "Main ecommerce image prompt should include every selling point");
    });
    assert.ok(formData.get("image") instanceof Blob, "Ecommerce image request should append image as a Blob.");

    return jsonResponse({
      data: [{ b64_json: "QUJD" }]
    });
  }) as typeof fetch,
  () =>
    generateEcommerceImage({
      apiKey: "key",
      baseUrl: "https://api.lts4ai.com",
      imageModel: "gpt-image-2",
      productImage: sourceImage,
      productTitle,
      copy: productCopy,
      type: "main"
    })
);
assert.equal(generatedImage.image.dataUrl, "data:image/png;base64,QUJD");

console.log("Ecommerce generation contract checks passed.");
