import { existsSync, readFileSync } from "node:fs";

const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const ecommerceGenerateFunction = new URL("../api/ecommerce/generate.ts", import.meta.url);
const ecommerceTasksFunction = new URL("../api/ecommerce/tasks.ts", import.meta.url);
const ecommerceTaskFunction = new URL("../api/ecommerce/tasks/[id].ts", import.meta.url);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const rewriteSources = vercel.rewrites?.map((rewrite) => rewrite.source) ?? [];
const functionConfig = vercel.functions ?? {};

assert(!api.includes('fetch("/api/models"'), "Model loading must not call the removed /api/models wrapper.");
assert(!api.includes('fetch("/api/generate"'), "Image generation must not call the removed /api/generate wrapper.");
assert(api.includes("return target.toString();"), "Provider requests must go directly to the configured Base URL.");
assert(api.includes('model.protocol === "openai_images"'), "Duplicate model IDs must prefer openai_images protocol in the browser client.");
assert(server.includes('model.protocol === "openai_images"'), "Duplicate model IDs must prefer openai_images protocol in the local server.");
assert(api.includes("resolveProtocolFromModelName"), "Browser client must resolve stale protocols from image model names.");
assert(server.includes("resolveProtocolFromModelName"), "Local server must resolve stale protocols from image model names.");
assert(app.includes("selectedModel?.protocol ?? resolveProtocolFromModelName"), "Generation must use the selected model protocol before falling back through model-name inference.");
assert(app.includes("protocol: generationProtocol"), "Generation requests and history must record the resolved model protocol.");
assert(!rewriteSources.includes("/api/:path*"), "Vercel must not proxy removed /api wrapper paths.");
assert(!rewriteSources.includes("/v1/:path*"), "Vercel must not proxy /v1 provider calls.");
assert(!rewriteSources.includes("/v1beta/:path*"), "Vercel must not proxy /v1beta provider calls.");
assert(existsSync(ecommerceGenerateFunction), "Vercel must expose POST /api/ecommerce/generate as a Function.");
assert(existsSync(ecommerceTasksFunction), "Vercel must expose GET /api/ecommerce/tasks as a Function.");
assert(existsSync(ecommerceTaskFunction), "Vercel must expose GET /api/ecommerce/tasks/:id as a Function.");
assert(
  rewriteSources.some((source) => source.includes("api/") && source.includes("_vercel/image")),
  "Vercel SPA fallback must exclude /api/* so ecommerce Functions can run."
);
assert(server.includes('"/api/ecommerce/generate"'), "Local Express server must mount ecommerce task creation.");
assert(server.includes('"/api/ecommerce/tasks"'), "Local Express server must mount ecommerce task listing.");
assert(server.includes('"/api/ecommerce/tasks/:id"'), "Local Express server must mount ecommerce task polling.");
assert(server.includes('"/local-cos"'), "Local Express server must expose local object storage files for dev history previews.");
assert(
  functionConfig["api/ecommerce/generate.ts"]?.maxDuration >= 300,
  "Ecommerce generation Function must allow a long-running provider request."
);
assert(!vite.includes('"/v1"') && !vite.includes('"/v1beta"'), "Vite dev proxy must not hide provider routing issues.");

console.log("Routing contract checks passed.");
