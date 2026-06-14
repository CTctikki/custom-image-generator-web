import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const ecommerce = readFileSync(new URL("../src/ecommerceGeneration.ts", import.meta.url), "utf8");
const ecommerceHistoryStore = readFileSync(new URL("../src/ecommerceHistoryStore.ts", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertMatch(value, pattern, message) {
  assert(pattern.test(value), message);
}

assert(
  app.includes('const DEFAULT_BASE_URL = "https://api.lts4ai.com"') && app.includes("baseUrl: DEFAULT_BASE_URL"),
  "Default Base URL must be https://api.lts4ai.com."
);
assert(app.includes("const INPUT_IMAGE_LIMIT = 12;"), "Reference image upload limit must be 12.");
assert(app.includes("const MAX_TOTAL_INPUT_IMAGE_BYTES = 15 * 1024 * 1024;"), "Reference image uploads must cap original file size at 15MB.");
assert(
  app.includes("const INPUT_IMAGE_COMPRESSED_TARGET_BYTES = 2 * 1024 * 1024;"),
  "Reference image uploads must have a stable compressed upload target."
);
assert(
  app.includes("const INPUT_IMAGE_COMPRESSION_QUALITY_STEPS =") &&
    app.includes("const INPUT_IMAGE_COMPRESSION_DIMENSION_STEPS ="),
  "Reference image compression must use multiple quality and dimension fallback steps."
);
assert(
  app.includes('const selectedImageFiles = imageFiles.slice(0, action.mode === "replace" ? 1 : INPUT_IMAGE_LIMIT);'),
  "Batch upload must honor the image limit before preparing images."
);
assert(
  app.includes("async function prepareInputImages") && app.includes("await prepareInputImages(selectedImageFiles)"),
  "Batch upload must prepare compressed reference images sequentially for stability."
);
assert(app.includes("inputImages.length >= INPUT_IMAGE_LIMIT"), "Add-image control must disable at the image limit.");
assert(types.includes("originalSize"), "InputImage must keep track of the original uploaded file size.");
assert(app.includes("const totalOriginalInputImageBytes ="), "Workbench must calculate the total original reference image size.");
assert(app.includes("const isInputImageSizeWithinLimit = totalOriginalInputImageBytes <= MAX_TOTAL_INPUT_IMAGE_BYTES;"), "Workbench must track whether the original upload total is within the 15MB limit.");

assert(
  app.includes('"http://64.186.244.43:12001"') && app.includes("LEGACY_DEFAULT_BASE_URLS"),
  "The old default Base URL must be migrated for existing localStorage users."
);

assert(app.includes("高级参数"), "Seed controls must live under the advanced parameter panel.");
assert(app.includes("seedLocked"), "Advanced seed lock state must be available.");
assert(app.includes("workspace.seed"), "Workspace seed state must be available for reproducible batches.");
assert(
  app.includes('const baseUrl = typeof workspace.baseUrl === "string" ? workspace.baseUrl.trim() : "";') &&
    app.includes("baseUrl: !baseUrl || LEGACY_DEFAULT_BASE_URLS.has(baseUrl) ? DEFAULT_BASE_URL : baseUrl,"),
  "Blank stored Base URL must fall back to the default provider URL."
);
assert(types.includes("seedLocked"), "WorkspaceState must expose seedLocked for advanced mode.");
assert(app.includes("同提示词 N 张") && app.includes("多提示词队列"), "Prompt generation mode switch must be rendered.");
assert(app.includes("parsePromptQueue"), "Prompt queue mode must parse one prompt per line.");
assert(app.includes("resolveEffectiveAspectRatio"), "Adaptive mode must follow the first reference image when dimensions are available.");
assert(app.includes('!isInputImageSizeWithinLimit') && app.includes("参考图原图总大小已超过 15MB"), "The run guard must block oversized original image totals with a Chinese message.");

assert(index.includes("<title>image studio-你的专属生图台</title>"), "Browser tab title must use the Image Studio branding.");
assert(index.includes('rel="icon"') && index.includes("/image-studio-icon.svg"), "Browser tab must use the Image Studio icon.");
assert(app.includes('href="https://ctikki.com"'), "Brand title must link to ctikki.com.");
assert(app.includes('href="https://pay.ldxp.cn/shop/AMTT76KG"'), "Top bar must expose the recharge link.");
assert(app.includes("topup-button") && styles.includes(".topup-button"), "Recharge link must have dedicated top bar styling.");
assert(app.includes("Ai交流群"), "Top bar must expose the AI community entry.");
assert(app.includes("ai-community-modal") && styles.includes(".ai-community-modal"), "AI community modal must have dedicated styling.");
assert(app.includes("/ai-community-qr.jpg"), "AI community modal must render the assistant WeChat QR code.");
assert(app.includes("Ctikki888"), "AI community modal must show the assistant WeChat ID.");
assert(app.includes('const ANNOUNCEMENT_VERSION = "2026-05-20";'), "Update announcement must be tied to the 2026-05-20 release.");
assert(app.includes('const ANNOUNCEMENT_STORAGE_KEY = "image-studio-announcement-version";'), "Update announcement must persist the viewed version.");
assert(app.includes("5.20更新公告") && app.includes("Ctikki888"), "Update announcement must show the requested release copy.");
assert(app.includes("release-announcement") && styles.includes(".release-announcement-backdrop"), "Update announcement must have dedicated modal styling.");
assert(app.includes(">Image Studio<"), "Primary brand title must render Image Studio.");
assert(app.includes("/image-studio-icon.svg"), "Header brand mark must use the Image Studio icon.");
assert(app.includes("downloadSelectedHistory"), "History manager must support batch image downloads.");
assert(app.includes('title="下载选中"'), "History manager must expose a selected-download button.");
assert(app.includes("downloadHistoryAsZip"), "Batch downloads must create one ZIP file.");
assert(!app.includes("selectedItems.forEach((item) => downloadDataUrl"), "Batch download must not trigger many separate browser downloads.");
assert(app.includes("history-title-row"), "History header must separate title content from actions.");
assert(app.includes('aria-label="历史批量操作"'), "History batch controls must be grouped for a cleaner layout.");
assert(styles.includes("clamp(260px, 19vw, 300px)"), "History sidebar should have enough dynamic width for batch controls.");
assert(styles.includes(".history-title-row"), "History title row must have dedicated styling.");
assert(styles.includes(".history-head.is-managing"), "Managing state must have dedicated history header styling.");
assert(app.includes("isHistorySidebarOpen"), "History must be controlled by an explicit sidebar open state.");
assert(app.includes("history-sidebar") && styles.includes(".history-sidebar"), "History must render as a dedicated sidebar.");
assert(app.includes("history-toggle-button") && app.includes("aria-expanded"), "History sidebar must expose an accessible toggle.");
assert(app.includes("workbench-shell") && styles.includes(".workbench-shell"), "Workbench content must shift together when the history sidebar opens.");
assert(styles.includes("--history-sidebar-width"), "History sidebar must use a width variable for dynamic extension.");
assert(styles.includes("flex-basis"), "History sidebar must animate width through flex-basis, not a static column.");
assert(styles.includes("--history-sidebar-inset"), "Open history sidebar must keep an inset from the right edge.");
assert(app.includes("compact-setting-row") && styles.includes(".compact-setting-row"), "Aspect ratio and quality controls must share one compact row.");
assert(app.includes('{ value: "Adaptive", label: "自动" }'), "Adaptive ratio label must be shortened to fit compact controls.");
const applyCasePromptBlock = app.slice(app.indexOf("const applyCasePrompt"), app.indexOf("const openCaseDetail"));
assert(
  applyCasePromptBlock.includes("setIsMobileCaseDetailOpen(false);"),
  "Applying a mobile case prompt must close the detail sheet and release body scroll lock."
);
assert(styles.includes('font-size: clamp(28px, 3vw, 42px);'), "Image Studio brand size must remain unchanged.");
assert(app.includes("generationTasks"), "Generation flow must expose per-image task cards.");
assert(app.includes('disabled={!canGenerate}') && app.includes("isInputImageSizeWithinLimit"), "Run button gating must include the 15MB original image limit.");
assert(app.includes("generation-task-grid"), "Result panel must render generation task cards.");
assert(styles.includes(".generation-task-card"), "Generation task cards must have dedicated styling.");
assert(
  app.includes('disabled={task.status === "queued" || task.status === "running"}'),
  "Failed generation task cards must stay interactive so the full error can be inspected."
);
assert(
  app.includes('title={task.status === "failed" ? task.message : undefined}'),
  "Failed generation task cards must expose the full error text."
);
assert(
  app.includes('task.status === "failed" ? task.message : task.prompt ? `${task.message} · ${task.prompt}` : task.message'),
  "Failed generation task cards must show the error without appending the prompt."
);
assert(
  styles.includes(".generation-task-card.is-failed .generation-task-copy small") &&
    styles.includes("-webkit-line-clamp: unset;") &&
    styles.includes("overflow-wrap: anywhere;"),
  "Failed generation task errors must not be clamped or overflow the card."
);
assert(!app.includes("lightboxImage"), "Generated result images must not open a large preview lightbox.");
assert(!styles.includes(".lightbox"), "Generated result image lightbox styling must be removed.");
assert(app.includes("toUserFacingError"), "App must convert technical errors into user-facing Chinese messages.");
assert(api.includes("toUserFacingError"), "Provider API layer must expose Chinese error normalization.");
assert(app.includes("当前原图总大小") && app.includes("15MB"), "Upload panel must show the live original-size total and the 15MB cap.");

assertMatch(
  app,
  /type\s+ActiveView\s*=\s*[^;]*"studio"[^;]*"cases"[^;]*"ecommerce"/s,
  "Top-level navigation state must include the ecommerce generation view."
);
assert(
  app.includes("view-tabs") && app.includes(">Image Studio<") && app.includes("案例专区") && app.includes("电商生图"),
  "Top bar must render 电商生图 beside Image Studio and 案例专区."
);
assert(app.includes('from "./ecommerceGeneration"'), "App must import ecommerce generation helpers.");
[
  "DEFAULT_ECOMMERCE_TEXT_MODEL",
  "DEFAULT_ECOMMERCE_IMAGE_MODEL",
  "ECOMMERCE_IMAGE_TASKS"
].forEach((name) => {
  assert(app.includes(name), `App must use ${name} from the ecommerce generation module.`);
});
assert(app.includes("createStoredEcommerceTask"), "App must create ecommerce tasks through the server task API.");
assert(app.includes("loadStoredEcommerceTask"), "App must poll ecommerce task status through the server task API.");
assert(app.includes("loadStoredEcommerceHistory"), "App must load ecommerce history from browser-local storage.");
assert(app.includes("saveStoredEcommerceHistory"), "App must persist ecommerce history to browser-local storage.");
assert(!app.includes("generateProductCopy"), "App must not call ecommerce text generation directly from the browser.");
assert(!app.includes("generateEcommerceImages({"), "App must not call ecommerce image generation directly from the browser.");
assert(app.includes("DEFAULT_ECOMMERCE_IMAGE_SIZE"), "App must use the default ecommerce image quality.");
assert(ecommerce.includes("generateEcommerceImages"), "Ecommerce service must expose the four-image generation orchestrator.");
assert(ecommerceHistoryStore.includes("ecommerceApiUrl"), "Ecommerce task API client must support a configurable server base URL.");
assert(ecommerceHistoryStore.includes('"/api/ecommerce/generate"'), "Ecommerce task creation must call the server API.");
assert(ecommerceHistoryStore.includes("taskId"), "Ecommerce task creation must expose the server task ID for polling.");
assert(
  ecommerceHistoryStore.includes("loadStoredEcommerceTask") &&
    ecommerceHistoryStore.includes("`/api/ecommerce/tasks/${"),
  "Ecommerce history store must expose GET /api/ecommerce/tasks/:id for polling."
);
assert(ecommerceHistoryStore.includes("custom-image-ecommerce-history-v1"), "Ecommerce history loading must use browser-local storage.");
assert(!ecommerceHistoryStore.includes("`/api/ecommerce/tasks?"), "Ecommerce history loading must not list shared server tasks.");
assert(!ecommerceHistoryStore.includes("indexedDB"), "Ecommerce history store must not use IndexedDB after server persistence is added.");
assert(
  app.includes("ecommerceProductTitle") && app.includes("商品标题"),
  "Ecommerce UI must expose a product title input."
);
assert(
  app.includes("ecommerceProductImage") && (app.includes("商品图") || app.includes("商品图片") || app.includes("商品底图")),
  "Ecommerce UI must expose a product image upload control."
);
assert(
  app.includes("ecommerceTextModel") && (app.includes("文本模型") || app.includes("文案模型")),
  "Ecommerce UI must expose an editable text model input."
);
assert(
  app.includes("ecommerceImageModel") && app.includes("图片模型"),
  "Ecommerce UI must expose an editable image model input."
);
assertMatch(
  app,
  /<select[\s\S]*setEcommerceTextModel[\s\S]*ecommerceTextModelOptions[\s\S]*<\/select>[\s\S]*<select[\s\S]*setEcommerceImageModel[\s\S]*ecommerceImageModelOptions[\s\S]*<\/select>/,
  "Ecommerce text and image model controls must be dropdowns backed by model options."
);
assert(
  app.includes("ecommerceImageSize") && app.includes("画质") && app.includes('useState<ImageSize>(DEFAULT_ECOMMERCE_IMAGE_SIZE)'),
  "Ecommerce UI must expose an image quality dropdown defaulting to 1K."
);
assert(
  app.includes("runEcommerceGenerate") && app.includes("一键生成"),
  "Ecommerce UI must expose a one-click generation action."
);
assertMatch(
  app,
  /regenerateEcommerceImages[\s\S]*(重新生成图片|重新生成4张图|重新生成 4 张图)|(重新生成图片|重新生成4张图|重新生成 4 张图)[\s\S]*regenerateEcommerceImages/,
  "Ecommerce UI must expose an action to regenerate the generated images."
);
assert(
  app.includes("ECOMMERCE_IMAGE_TASKS") &&
    ["main", "scene", "sellingPoints", "whiteBackground"].every((type) => ecommerce.includes(`type: "${type}"`)) &&
    ["主图", "场景图", "卖点图", "白底图"].every((label) => ecommerce.includes(label)),
  "Ecommerce results must cover 主图、场景图、卖点图、白底图."
);
assert(
  app.includes("downloadCurrentEcommerceResults") && app.includes("downloadHistoryAsZip") && app.includes("打包下载本组"),
  "Ecommerce results must support one-click ZIP download for the current group."
);
assert(
  app.includes("EcommerceHistoryItem") &&
    app.includes("loadStoredEcommerceHistory") &&
    app.includes("createStoredEcommerceTask") &&
    app.includes("setEcommerceHistory") &&
    app.includes("ecommerce-history-panel"),
  "Ecommerce results must be stored in a separate server-backed ecommerce task history library."
);
const ecommerceGenerationBlock = app.slice(app.indexOf("const runEcommerceImageGeneration"), app.indexOf("const runEcommerceGenerate"));
assert(
  ecommerceGenerationBlock.includes("setEcommerceHistory") && !ecommerceGenerationBlock.includes("setHistory("),
  "Successful ecommerce results must not be written into the Image Studio workbench history."
);
assert(
  app.includes("ecommerce-page") &&
    app.includes("ecommerce-panel") &&
    app.includes("ecommerce-results-grid") &&
    styles.includes(".ecommerce-page") &&
    styles.includes(".ecommerce-panel") &&
    styles.includes(".ecommerce-results-grid"),
  "Ecommerce page, panel, and results grid must have dedicated static classes."
);

console.log("UI contract checks passed.");
