import {
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageCircle,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sun,
  Trash2,
  Unlock,
  UploadCloud,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode
} from "react";
import { fetchProviderModels, generateImage, resolveProtocolFromModelName, toUserFacingError } from "./api";
import { CASE_LIBRARY_SOURCE, loadCaseLibrary, loadCasePrompt, type CaseLibraryItem, type CasePromptMap } from "./caseLibrary";
import {
  DEFAULT_ECOMMERCE_IMAGE_MODEL,
  DEFAULT_ECOMMERCE_IMAGE_SIZE,
  DEFAULT_ECOMMERCE_TEXT_MODEL,
  ECOMMERCE_IMAGE_TASKS,
  type EcommerceImageTaskType,
  type ProductCopy
} from "./ecommerceGeneration";
import {
  createStoredEcommerceTask,
  loadStoredEcommerceTask,
  loadStoredEcommerceHistory,
  saveStoredEcommerceHistory,
  type EcommerceHistoryImage,
  type EcommerceHistoryItem
} from "./ecommerceHistoryStore";
import { resolveGenerationParallelism, settleGenerationTasks } from "./generationExecution";
import { createGenerationPlan, MAX_GENERATION_COUNT, parsePromptQueue, resolveEffectiveAspectRatio } from "./generationPlan";
import { loadStoredHistory, saveStoredHistory } from "./historyStore";
import type { AspectRatio, HistoryItem, ImageSize, InputImage, ProviderModelOption, WorkspaceState } from "./types";
import { downloadHistoryAsZip } from "./zipArchive";

const WORKSPACE_KEY = "custom-image-workspace-v2";
const ANNOUNCEMENT_VERSION = "2026-05-20";
const ANNOUNCEMENT_STORAGE_KEY = "image-studio-announcement-version";
const DEFAULT_MODEL_MIGRATION_KEY = "custom-image-default-model-migration";
const DEFAULT_MODEL_MIGRATION_VERSION = "image2-2026-06-03";
const INPUT_IMAGE_LIMIT = 12;
const MAX_TOTAL_INPUT_IMAGE_BYTES = 15 * 1024 * 1024;
const HISTORY_LIMIT = 40;
const ECOMMERCE_HISTORY_LIMIT = 30;
const ECOMMERCE_TASK_POLL_INTERVAL_MS = 2500;
const ECOMMERCE_TASK_MAX_POLLS = 120;
const DEFAULT_BASE_URL = "https://api.lts4ai.com";
const LEGACY_DEFAULT_BASE_URLS = new Set(["http://64.186.244.43:12001"]);
const LEGACY_DEFAULT_MODEL_NAMES = new Set(["gemini-3.1-flash-image"]);
const LEGACY_DEFAULT_PROMPTS = new Set([
  "把参考图中的服装穿到模特身上，保持版型、材质和细节一致。"
]);

const ASPECT_RATIO_OPTIONS: Array<{ value: AspectRatio; label: string }> = [
  { value: "Adaptive", label: "自动" },
  { value: "1:1", label: "正方形 1:1" },
  { value: "16:9", label: "横屏 16:9" },
  { value: "21:9", label: "超宽屏 21:9" },
  { value: "4:3", label: "横向标准 4:3" },
  { value: "3:2", label: "横向照片 3:2" },
  { value: "5:4", label: "横向近方 5:4" },
  { value: "2:1", label: "横向宽幅 2:1" },
  { value: "3:4", label: "竖向标准 3:4" },
  { value: "2:3", label: "竖向照片 2:3" },
  { value: "4:5", label: "竖向电商 4:5" },
  { value: "9:16", label: "竖屏 9:16" }
];

const IMAGE_SIZES: ImageSize[] = ["4K", "2K", "1K"];
const ALL_CASE_CATEGORY = "全部";
const CASE_GRID_MIN_COLUMN_WIDTH = 190;
const CASE_GRID_GAP = 14;
const CASE_GRID_OVERSCAN_ROWS = 2;
const CASE_GRID_FALLBACK_ROW_HEIGHT = 265;

const CASE_CATEGORY_LABELS: Record<string, string> = {
  "Architecture & Spaces": "建筑空间",
  "Brand & Logos": "品牌标志",
  "Characters & People": "角色人物",
  "Charts & Infographics": "信息图表",
  "Documents & Publishing": "文档出版",
  "History & Classical Themes": "历史古风",
  "Illustration & Art": "插画艺术",
  "Other Use Cases": "其他案例",
  "Photography & Realism": "摄影写实",
  "Posters & Typography": "海报字体",
  "Products & E-commerce": "产品电商",
  "Scenes & Storytelling": "场景叙事",
  "UI & Interfaces": "界面设计"
};

type GenerationTaskStatus = "queued" | "running" | "success" | "failed";
type ActiveView = "studio" | "cases" | "ecommerce";
type CaseImageLoadState = "loading" | "loaded" | "failed";

interface CaseGridMetrics {
  columns: number;
  isMobile: boolean;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  width: number;
}

interface GenerationTask {
  id: string;
  index: number;
  status: GenerationTaskStatus;
  message: string;
  prompt?: string;
  seed?: number;
  aspectRatio?: AspectRatio;
  imageDataUrl?: string;
  mimeType?: string;
  createdAt?: string;
  historyId?: string;
}

interface EcommerceResultTask {
  type: EcommerceImageTaskType;
  label: string;
  title: string;
  name: string;
  status: GenerationTaskStatus;
  message: string;
  prompt?: string;
  imageDataUrl?: string;
  mimeType?: string;
  createdAt?: string;
  historyId?: string;
}

const EMPTY_ECOMMERCE_COPY: ProductCopy = {
  sellingPoints: ["", "", ""],
  longTitle: "",
  shortTitle: ""
};

function createEcommerceResultTasks(status: GenerationTaskStatus = "queued", message = "待生成"): EcommerceResultTask[] {
  return ECOMMERCE_IMAGE_TASKS.map((task) => ({
    ...task,
    status,
    message
  }));
}

function normalizeEcommerceCopy(copy: ProductCopy): ProductCopy {
  return {
    sellingPoints: [0, 1, 2].map((index) => copy.sellingPoints[index]?.trim() ?? ""),
    longTitle: copy.longTitle.trim(),
    shortTitle: copy.shortTitle.trim()
  };
}

function isEcommerceCopyComplete(copy: ProductCopy) {
  const normalized = normalizeEcommerceCopy(copy);
  return normalized.longTitle.length > 0 && normalized.shortTitle.length > 0 && normalized.sellingPoints.every(Boolean);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTerminalEcommerceTask(item: EcommerceHistoryItem) {
  return item.status === "completed" || item.status === "failed" || item.status === "delivery_failed";
}

function upsertEcommerceHistoryItem(current: EcommerceHistoryItem[], item: EcommerceHistoryItem) {
  return [item, ...current.filter((candidate) => candidate.id !== item.id)].slice(0, ECOMMERCE_HISTORY_LIMIT);
}

function buildEcommerceResultTasksFromHistory(item: EcommerceHistoryItem): EcommerceResultTask[] {
  return ECOMMERCE_IMAGE_TASKS.map((task) => {
    const image = item.images.find((candidate) => candidate.type === task.type);
    const imageUrl = image?.imageDataUrl ?? image?.cosUrl ?? "";

    if (image && image.status !== "failed" && imageUrl) {
      return {
        ...task,
        status: "success" as const,
        message: "生成完成",
        prompt: image.prompt,
        imageDataUrl: imageUrl,
        mimeType: image.mimeType ?? "image/png",
        createdAt: image.createdAt,
        historyId: item.id
      };
    }

    return {
      ...task,
      status: "failed" as const,
      message: image?.error ?? "电商图片生成失败。"
    };
  });
}

function getCaseGridColumnCount(width: number) {
  return Math.max(1, Math.floor((Math.max(0, width) + CASE_GRID_GAP) / (CASE_GRID_MIN_COLUMN_WIDTH + CASE_GRID_GAP)));
}

function parsePixelValue(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGridColumnCount(value: string | undefined) {
  if (!value || value === "none") {
    return 0;
  }

  return value.split(" ").filter((column) => column.trim().length > 0 && column !== "none").length;
}

const DEFAULT_WORKSPACE: WorkspaceState = {
  theme: "light",
  prompt: "",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  modelName: "",
  protocol: "gemini_generate_content",
  aspectRatio: "Adaptive",
  imageSize: "2K",
  concurrency: 1,
  promptMode: "count",
  seed: 0,
  seedLocked: false
};

function readStoredWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const workspace = { ...DEFAULT_WORKSPACE, ...parsed };
    const baseUrl = typeof workspace.baseUrl === "string" ? workspace.baseUrl.trim() : "";
    const storedModelName = typeof workspace.modelName === "string" ? workspace.modelName : "";
    let modelName = storedModelName;
    try {
      if (
        localStorage.getItem(DEFAULT_MODEL_MIGRATION_KEY) !== DEFAULT_MODEL_MIGRATION_VERSION &&
        LEGACY_DEFAULT_MODEL_NAMES.has(storedModelName)
      ) {
        modelName = "";
        localStorage.setItem(DEFAULT_MODEL_MIGRATION_KEY, DEFAULT_MODEL_MIGRATION_VERSION);
      }
    } catch {
      // Ignore restricted storage; model loading will still pick the default for fresh sessions.
    }
    const protocol =
      workspace.protocol === "gemini_generate_content" ||
      workspace.protocol === "openai_chat_completions" ||
      workspace.protocol === "openai_images"
        ? workspace.protocol
        : DEFAULT_WORKSPACE.protocol;

    return {
      theme: workspace.theme === "dark" ? "dark" : "light",
      prompt: LEGACY_DEFAULT_PROMPTS.has(workspace.prompt) ? "" : workspace.prompt,
      apiKey: typeof workspace.apiKey === "string" ? workspace.apiKey : "",
      baseUrl: !baseUrl || LEGACY_DEFAULT_BASE_URLS.has(baseUrl) ? DEFAULT_BASE_URL : baseUrl,
      modelName,
      protocol: resolveProtocolFromModelName(modelName, protocol),
      aspectRatio: workspace.aspectRatio,
      imageSize: workspace.imageSize,
      concurrency: Math.min(10, Math.max(1, Number.parseInt(String(workspace.concurrency), 10) || 1)),
      promptMode: workspace.promptMode === "queue" ? "queue" : "count",
      seed: Math.max(0, Number.parseInt(String(workspace.seed), 10) || 0),
      seedLocked: Boolean(workspace.seedLocked)
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

function hasSeenAnnouncementVersion() {
  try {
    return localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY) === ANNOUNCEMENT_VERSION;
  } catch {
    return false;
  }
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("无法读取图片数据。");
  }
  return { mimeType: match[1], data: match[2] };
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Image dimensions unavailable."));
    image.src = dataUrl;
  });
}

const INPUT_IMAGE_COMPRESSION_THRESHOLD_BYTES = 3 * 1024 * 1024;
const INPUT_IMAGE_COMPRESSED_TARGET_BYTES = 2 * 1024 * 1024;
const INPUT_IMAGE_MAX_DIMENSION = 2560;
const INPUT_IMAGE_COMPRESSION_DIMENSION_STEPS = [INPUT_IMAGE_MAX_DIMENSION, 2200, 1800, 1536] as const;
const INPUT_IMAGE_COMPRESSION_QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62] as const;

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Image compression failed."));
      },
      mimeType,
      quality
    );
  });
}

async function compressInputImage(file: File): Promise<File> {
  if (file.size <= INPUT_IMAGE_COMPRESSION_THRESHOLD_BYTES && file.size <= INPUT_IMAGE_COMPRESSED_TARGET_BYTES) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Failed to read image: ${file.name}`));
      image.src = objectUrl;
    });

    const maxNaturalDimension = Math.max(image.naturalWidth, image.naturalHeight);
    if (maxNaturalDimension <= 0) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "input";
    let bestCompressedFile: File | null = null;

    for (const dimensionLimit of INPUT_IMAGE_COMPRESSION_DIMENSION_STEPS) {
      const scale = Math.min(1, dimensionLimit / maxNaturalDimension);
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        return bestCompressedFile && bestCompressedFile.size < file.size ? bestCompressedFile : file;
      }

      context.drawImage(image, 0, 0, width, height);
      for (const quality of INPUT_IMAGE_COMPRESSION_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        const compressedFile = new File([blob], `${baseName}-compressed.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now()
        });

        if (!bestCompressedFile || compressedFile.size < bestCompressedFile.size) {
          bestCompressedFile = compressedFile;
        }

        if (compressedFile.size <= INPUT_IMAGE_COMPRESSED_TARGET_BYTES) {
          return compressedFile;
        }
      }
    }

    return bestCompressedFile && bestCompressedFile.size < file.size ? bestCompressedFile : file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function fileToInputImage(file: File, originalSize = file.size): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      const parsed = parseDataUrl(dataUrl);
      const dimensions = await readImageDimensions(dataUrl).catch(() => null);
      resolve({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        mimeType: parsed.mimeType,
        data: parsed.data,
        dataUrl,
        size: file.size,
        originalSize,
        width: dimensions?.width,
        height: dimensions?.height
      });
    };
    reader.readAsDataURL(file);
  });
}

async function fileToCompressedInputImage(file: File): Promise<InputImage> {
  return fileToInputImage(await compressInputImage(file), file.size);
}

async function prepareInputImages(files: File[]): Promise<InputImage[]> {
  const images: InputImage[] = [];
  for (const file of files) {
    images.push(await fileToCompressedInputImage(file));
  }
  return images;
}

function readableSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function randomSeed() {
  return Math.floor(Math.random() * 2_147_483_647);
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("webp")) {
    return "webp";
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  return "png";
}

function downloadDataUrl(input: { dataUrl: string; mimeType: string; createdAt?: string }) {
  const anchor = document.createElement("a");
  const timestamp = (input.createdAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  anchor.href = input.dataUrl;
  anchor.download = `custom-image-${timestamp}.${extensionFromMimeType(input.mimeType)}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function compactError(error: unknown) {
  return toUserFacingError(error);
}

function compactPrompt(prompt: string, maxLength = 150) {
  const compacted = prompt.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, maxLength).trim()}...`;
}

function localizeCaseCategory(category: string) {
  return CASE_CATEGORY_LABELS[category] ?? category;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function pickDefaultModel(models: ProviderModelOption[], currentModelName: string) {
  const currentModel = models.find((model) => model.id === currentModelName);
  if (currentModel) {
    return currentModel;
  }

  return models[0] ?? null;
}

function isEcommerceImageModelOption(model: ProviderModelOption) {
  return model.protocol === "openai_images" || /image|dall-e|imagen/iu.test(model.id);
}

function withFallbackModelOption(
  models: ProviderModelOption[],
  currentModelName: string,
  fallbackModelName: string,
  protocol: ProviderModelOption["protocol"]
) {
  const optionIds = new Set(models.map((model) => model.id));
  const fallbackId = currentModelName.trim() || fallbackModelName;

  if (!fallbackId || optionIds.has(fallbackId)) {
    return models;
  }

  return [{ id: fallbackId, protocol }, ...models];
}

interface CaseLibraryDetailPanelProps {
  caseItem: CaseLibraryItem;
  prompt: string;
  copiedCaseId: number | null;
  canUsePrompt: boolean;
  isCasePromptLoading: boolean;
  headerAction?: ReactNode;
  onCopy: (caseItem: CaseLibraryItem) => Promise<void>;
  onApply: (caseItem: CaseLibraryItem) => void;
}

function CaseLibraryDetailPanel({
  caseItem,
  prompt,
  copiedCaseId,
  canUsePrompt,
  isCasePromptLoading,
  headerAction,
  onCopy,
  onApply
}: CaseLibraryDetailPanelProps) {
  return (
    <>
      <div className="case-detail-media">
        <img alt={caseItem.imageAlt} decoding="async" fetchPriority="high" src={caseItem.image} />
      </div>
      <div className="case-detail-content">
        <div className="case-detail-head">
          <div className="case-detail-meta">
            <span>案例 #{caseItem.id}</span>
            <span>{localizeCaseCategory(caseItem.category)}</span>
          </div>
          {headerAction}
        </div>
        <h2>{caseItem.title}</h2>
        <p>{compactPrompt(caseItem.promptPreview, 180)}</p>
        <div className="case-tags">
          {caseItem.tags.slice(0, 8).map((tag) => (
            <span key={`${caseItem.id}-${tag}`}>{tag}</span>
          ))}
        </div>
        <div className="case-detail-actions">
          <button
            className="text-button"
            disabled={!canUsePrompt || isCasePromptLoading}
            onClick={() => void onCopy(caseItem)}
            type="button"
          >
            <Copy size={17} />
            {copiedCaseId === caseItem.id ? "已复制" : "复制提示词"}
          </button>
          <button
            className="text-button is-primary"
            disabled={!canUsePrompt || isCasePromptLoading}
            onClick={() => onApply(caseItem)}
            type="button"
          >
            <Play size={17} />
            套用到工作台
          </button>
          <a className="text-button" href={caseItem.githubUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={17} />
            源案例
          </a>
        </div>
        <div className="case-prompt-panel">
          <div>
            <strong>提示词</strong>
            {caseItem.sourceUrl ? (
              <a href={caseItem.sourceUrl} rel="noreferrer" target="_blank">
                {caseItem.sourceLabel}
              </a>
            ) : (
              <span>{caseItem.sourceLabel}</span>
            )}
          </div>
          {canUsePrompt ? (
            <pre>{prompt}</pre>
          ) : (
            <div className="case-prompt-loading">
              <Loader2 className={isCasePromptLoading ? "spin" : ""} size={18} />
              <span>{isCasePromptLoading ? "正在加载完整提示词..." : "提示词暂时不可用。"}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>("studio");
  const [isUpdateAnnouncementOpen, setIsUpdateAnnouncementOpen] = useState(() => !hasSeenAnnouncementVersion());
  const [isAiCommunityOpen, setIsAiCommunityOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState>(readStoredWorkspace);
  const [modelOptions, setModelOptions] = useState<ProviderModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [inputImages, setInputImages] = useState<InputImage[]>([]);
  const [selectedInputIndex, setSelectedInputIndex] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [isManagingHistory, setIsManagingHistory] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [ecommerceProductTitle, setEcommerceProductTitle] = useState("");
  const [ecommerceProductImage, setEcommerceProductImage] = useState<InputImage | null>(null);
  const [ecommerceTextModel, setEcommerceTextModel] = useState(DEFAULT_ECOMMERCE_TEXT_MODEL);
  const [ecommerceImageModel, setEcommerceImageModel] = useState(DEFAULT_ECOMMERCE_IMAGE_MODEL);
  const [ecommerceImageSize, setEcommerceImageSize] = useState<ImageSize>(DEFAULT_ECOMMERCE_IMAGE_SIZE);
  const [ecommerceCopy, setEcommerceCopy] = useState<ProductCopy>(EMPTY_ECOMMERCE_COPY);
  const [ecommerceResults, setEcommerceResults] = useState<EcommerceResultTask[]>(() => createEcommerceResultTasks());
  const [ecommerceHistory, setEcommerceHistory] = useState<EcommerceHistoryItem[]>([]);
  const [isEcommerceHistoryLoaded, setIsEcommerceHistoryLoaded] = useState(false);
  const [isEcommerceGenerating, setIsEcommerceGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("工作台就绪。");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isHistorySidebarOpen, setIsHistorySidebarOpen] = useState(false);
  const [caseLibraryItems, setCaseLibraryItems] = useState<CaseLibraryItem[]>([]);
  const [caseLibraryCategories, setCaseLibraryCategories] = useState<string[]>([]);
  const [casePromptsById, setCasePromptsById] = useState<CasePromptMap>({});
  const [caseLibraryTotal, setCaseLibraryTotal] = useState(CASE_LIBRARY_SOURCE.totalCases);
  const [isCaseLibraryLoading, setIsCaseLibraryLoading] = useState(true);
  const [loadingCasePromptId, setLoadingCasePromptId] = useState<number | null>(null);
  const [caseLibraryError, setCaseLibraryError] = useState("");
  const [caseLibraryQuery, setCaseLibraryQuery] = useState("");
  const [selectedCaseCategory, setSelectedCaseCategory] = useState(ALL_CASE_CATEGORY);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [caseGridMetrics, setCaseGridMetrics] = useState<CaseGridMetrics>({
    columns: 1,
    isMobile: false,
    rowHeight: CASE_GRID_FALLBACK_ROW_HEIGHT,
    scrollTop: 0,
    viewportHeight: CASE_GRID_FALLBACK_ROW_HEIGHT * 2,
    width: 0
  });
  const [isMobileCaseDetailOpen, setIsMobileCaseDetailOpen] = useState(false);
  const [copiedCaseId, setCopiedCaseId] = useState<number | null>(null);
  const [caseImageLoadState, setCaseImageLoadState] = useState<Record<number, CaseImageLoadState>>({});
  const [fileAction, setFileAction] = useState<{ mode: "append" | "replace"; index: number | null }>({
    mode: "append",
    index: null
  });
  const modelLoadRequestRef = useRef(0);
  const caseGridViewportRef = useRef<HTMLDivElement | null>(null);
  const caseGridWindowRef = useRef<HTMLDivElement | null>(null);
  const firstCaseCardRef = useRef<HTMLButtonElement | null>(null);
  const caseGridMeasureFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ecommerceFileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedInputImage = inputImages[selectedInputIndex] ?? null;
  const visibleHistoryItem = useMemo(() => {
    if (history.length === 0) {
      return null;
    }
    return history.find((item) => item.id === selectedHistoryId) ?? history[0];
  }, [history, selectedHistoryId]);

  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.id === workspace.modelName) ?? null,
    [modelOptions, workspace.modelName]
  );
  const ecommerceTextModelOptions = useMemo(
    () =>
      withFallbackModelOption(
        modelOptions.filter((model) => !isEcommerceImageModelOption(model)),
        ecommerceTextModel,
        DEFAULT_ECOMMERCE_TEXT_MODEL,
        "openai_chat_completions"
      ),
    [ecommerceTextModel, modelOptions]
  );
  const ecommerceImageModelOptions = useMemo(
    () =>
      withFallbackModelOption(
        modelOptions.filter(isEcommerceImageModelOption),
        ecommerceImageModel,
        DEFAULT_ECOMMERCE_IMAGE_MODEL,
        "openai_images"
      ),
    [ecommerceImageModel, modelOptions]
  );
  const filteredCaseLibrary = useMemo(() => {
    const query = caseLibraryQuery.trim().toLowerCase();
    return caseLibraryItems.filter((caseItem) => {
      const matchesCategory = selectedCaseCategory === ALL_CASE_CATEGORY || caseItem.category === selectedCaseCategory;
      const haystack =
        `${caseItem.id} ${caseItem.title} ${caseItem.category} ${caseItem.sourceLabel} ${caseItem.tags.join(" ")} ${caseItem.promptPreview}`.toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [caseLibraryItems, caseLibraryQuery, selectedCaseCategory]);
  const selectedCaseItem = useMemo(
    () => caseLibraryItems.find((caseItem) => caseItem.id === selectedCaseId) ?? filteredCaseLibrary[0] ?? caseLibraryItems[0] ?? null,
    [caseLibraryItems, filteredCaseLibrary, selectedCaseId]
  );
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const selectedCasePrompt = selectedCaseItem ? (casePromptsById[selectedCaseItem.id] ?? selectedCaseItem.prompt ?? "") : "";
  const isCasePromptLoading = selectedCaseItem !== null && loadingCasePromptId === selectedCaseItem.id;
  const canUseSelectedCasePrompt = selectedCasePrompt.trim().length > 0;
  const caseGridTotalRows = Math.ceil(filteredCaseLibrary.length / caseGridMetrics.columns);
  const caseGridTotalHeight = Math.max(0, caseGridTotalRows * caseGridMetrics.rowHeight);
  const caseGridVisibleWindow = useMemo(() => {
    if (filteredCaseLibrary.length === 0) {
      return {
        endIndex: 0,
        offsetY: 0,
        startIndex: 0,
        totalHeight: 0
      };
    }

    const startRow = Math.max(0, Math.floor(caseGridMetrics.scrollTop / caseGridMetrics.rowHeight) - CASE_GRID_OVERSCAN_ROWS);
    const endRow = Math.min(
      caseGridTotalRows,
      Math.ceil((caseGridMetrics.scrollTop + caseGridMetrics.viewportHeight) / caseGridMetrics.rowHeight) +
        CASE_GRID_OVERSCAN_ROWS
    );

    return {
      endIndex: Math.min(filteredCaseLibrary.length, endRow * caseGridMetrics.columns),
      offsetY: startRow * caseGridMetrics.rowHeight,
      startIndex: startRow * caseGridMetrics.columns,
      totalHeight: caseGridTotalHeight
    };
  }, [
    caseGridMetrics.columns,
    caseGridMetrics.rowHeight,
    caseGridMetrics.scrollTop,
    caseGridMetrics.viewportHeight,
    caseGridTotalHeight,
    caseGridTotalRows,
    filteredCaseLibrary.length
  ]);
  const visibleCaseLibrary = useMemo(
    () => filteredCaseLibrary.slice(caseGridVisibleWindow.startIndex, caseGridVisibleWindow.endIndex),
    [caseGridVisibleWindow.endIndex, caseGridVisibleWindow.startIndex, filteredCaseLibrary]
  );
  const promptQueue = useMemo(() => parsePromptQueue(workspace.prompt), [workspace.prompt]);
  const plannedTaskCount =
    workspace.promptMode === "queue"
      ? Math.min(MAX_GENERATION_COUNT, promptQueue.length)
      : Math.min(MAX_GENERATION_COUNT, Math.max(1, Number.parseInt(String(workspace.concurrency), 10) || 1));
  const totalOriginalInputImageBytes = useMemo(
    () => inputImages.reduce((sum, image) => sum + image.originalSize, 0),
    [inputImages]
  );
  const isInputImageSizeWithinLimit = totalOriginalInputImageBytes <= MAX_TOTAL_INPUT_IMAGE_BYTES;
  const effectiveAspectRatio = useMemo(
    () => resolveEffectiveAspectRatio(workspace.aspectRatio, inputImages),
    [inputImages, workspace.aspectRatio]
  );
  const canGenerate =
    !isGenerating &&
    !isLoadingModels &&
    plannedTaskCount > 0 &&
    isInputImageSizeWithinLimit &&
    workspace.baseUrl.trim().length > 0 &&
    workspace.modelName.trim().length > 0 &&
    modelOptions.some((model) => model.id === workspace.modelName);
  const ecommerceCopyIsComplete = isEcommerceCopyComplete(ecommerceCopy);
  const canGenerateEcommerceImages =
    !isEcommerceGenerating &&
    workspace.baseUrl.trim().length > 0 &&
    workspace.apiKey.trim().length > 0 &&
    ecommerceProductTitle.trim().length > 0 &&
    ecommerceProductImage !== null &&
    ecommerceImageModel.trim().length > 0;
  const canGenerateEcommerce = canGenerateEcommerceImages && ecommerceTextModel.trim().length > 0;
  const canRegenerateEcommerceImages = canGenerateEcommerceImages && ecommerceCopyIsComplete;
  const visibleStatusMessage =
    activeView === "cases"
      ? statusMessage.startsWith("已复制案例") || statusMessage.startsWith("已将案例")
        ? statusMessage
        : isCaseLibraryLoading
          ? "案例库加载中..."
          : caseLibraryError || `案例库就绪：${caseLibraryTotal || caseLibraryItems.length} 个案例。`
      : statusMessage;
  const isStatusBusy =
    activeView === "cases" ? isCaseLibraryLoading : activeView === "ecommerce" ? isEcommerceGenerating : isGenerating || isLoadingModels;

  const measureCaseGrid = useCallback(() => {
    const viewport = caseGridViewportRef.current;
    const gridWindow = caseGridWindowRef.current;
    if (!viewport || !gridWindow) {
      return;
    }

    const isCaseGridMobile = window.matchMedia("(max-width: 900px)").matches;
    const viewportRect = viewport.getBoundingClientRect();
    const gridStyles = window.getComputedStyle(gridWindow);
    const measuredColumns = parseGridColumnCount(gridStyles.gridTemplateColumns);
    const measuredGap = parsePixelValue(gridStyles.rowGap || gridStyles.gap, CASE_GRID_GAP);
    const measuredCardHeight = firstCaseCardRef.current?.getBoundingClientRect().height ?? 0;
    const nextRowHeight = measuredCardHeight > 0 ? measuredCardHeight + measuredGap : CASE_GRID_FALLBACK_ROW_HEIGHT;
    const absoluteViewportTop = viewportRect.top + window.scrollY;
    const usesWindowScroll =
      isCaseGridMobile || viewport.scrollHeight <= viewport.clientHeight + 1 || viewportRect.height > window.innerHeight;
    const nextScrollTop = usesWindowScroll ? Math.max(0, window.scrollY - absoluteViewportTop) : viewport.scrollTop;
    const nextViewportHeight = usesWindowScroll ? window.innerHeight : viewport.clientHeight || window.innerHeight;
    const nextWidth = viewport.clientWidth || viewportRect.width;
    const nextColumns = Math.max(1, measuredColumns || getCaseGridColumnCount(nextWidth));

    setCaseGridMetrics((current) => {
      const next = {
        columns: nextColumns,
        isMobile: isCaseGridMobile,
        rowHeight: nextRowHeight,
        scrollTop: nextScrollTop,
        viewportHeight: nextViewportHeight,
        width: nextWidth
      };

      if (
        current.columns === next.columns &&
        current.isMobile === next.isMobile &&
        Math.abs(current.rowHeight - next.rowHeight) < 0.5 &&
        Math.abs(current.scrollTop - next.scrollTop) < 0.5 &&
        Math.abs(current.viewportHeight - next.viewportHeight) < 0.5 &&
        Math.abs(current.width - next.width) < 0.5
      ) {
        return current;
      }

      return next;
    });
  }, []);

  const scheduleCaseGridMeasure = useCallback(() => {
    if (caseGridMeasureFrameRef.current !== null) {
      return;
    }

    caseGridMeasureFrameRef.current = window.requestAnimationFrame(() => {
      caseGridMeasureFrameRef.current = null;
      measureCaseGrid();
    });
  }, [measureCaseGrid]);

  const resetCaseGridWindow = useCallback(() => {
    const viewport = caseGridViewportRef.current;
    if (viewport) {
      viewport.scrollTop = 0;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setCaseGridMetrics((current) => ({ ...current, scrollTop: 0 }));
  }, []);

  const openCaseLibraryView = useCallback(() => {
    resetCaseGridWindow();
    setActiveView("cases");
  }, [resetCaseGridWindow]);

  const openEcommerceView = useCallback(() => {
    setIsMobileCaseDetailOpen(false);
    setIsManagingHistory(false);
    setIsHistorySidebarOpen(false);
    setActiveView("ecommerce");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const updateWorkspace = useCallback((patch: Partial<WorkspaceState>) => {
    setWorkspace((current) => ({ ...current, ...patch }));
  }, []);

  const markCaseImageState = useCallback((caseId: number, state: CaseImageLoadState) => {
    setCaseImageLoadState((current) => {
      if (current[caseId] === state) {
        return current;
      }

      return {
        ...current,
        [caseId]: state
      };
    });
  }, []);

  const copyCasePrompt = useCallback(async (caseItem: CaseLibraryItem) => {
    const prompt = casePromptsById[caseItem.id] ?? caseItem.prompt ?? "";
    if (!prompt.trim()) {
      setStatusMessage("提示词仍在加载，请稍后再试。");
      return;
    }

    try {
      await copyTextToClipboard(prompt);
      setCopiedCaseId(caseItem.id);
      setStatusMessage(`已复制案例「${caseItem.title}」的提示词。`);
      window.setTimeout(() => {
        setCopiedCaseId((current) => (current === caseItem.id ? null : current));
      }, 1800);
    } catch {
      setStatusMessage("复制失败，请在详情里手动选中提示词。");
    }
  }, []);

  const applyCasePrompt = useCallback(
    (caseItem: CaseLibraryItem) => {
      const prompt = casePromptsById[caseItem.id] ?? caseItem.prompt ?? "";
      if (!prompt.trim()) {
        setStatusMessage("提示词仍在加载，请稍后再试。");
        return;
      }

      updateWorkspace({
        prompt,
        promptMode: "count"
      });
      setIsMobileCaseDetailOpen(false);
      setActiveView("studio");
      setStatusMessage(`已将案例「${caseItem.title}」套用到工作台。`);
    },
    [casePromptsById, updateWorkspace]
  );

  const openCaseDetail = useCallback((caseId: number) => {
    setSelectedCaseId(caseId);
    if (window.matchMedia("(max-width: 900px)").matches) {
      setIsMobileCaseDetailOpen(true);
    }
  }, []);

  const loadModels = useCallback(
    async (mode: "auto" | "manual" = "manual") => {
      const baseUrl = workspace.baseUrl.trim();
      if (!baseUrl) {
        setModelOptions([]);
        updateWorkspace({ modelName: "" });
        setStatusMessage("请先填写 Base URL。");
        return;
      }

      const requestId = modelLoadRequestRef.current + 1;
      modelLoadRequestRef.current = requestId;
      setIsLoadingModels(true);
      if (mode === "manual") {
        setStatusMessage("正在获取模型列表...");
      }

      try {
        const result = await fetchProviderModels({
          baseUrl,
          apiKey: workspace.apiKey
        });
        if (modelLoadRequestRef.current !== requestId) {
          return;
        }

        setModelOptions(result.models);
        setWorkspace((current) => {
          const nextModel = pickDefaultModel(result.models, current.modelName);
          return {
            ...current,
            modelName: nextModel?.id ?? "",
            protocol: nextModel?.protocol ?? current.protocol
          };
        });
        setStatusMessage(`已获取 ${result.models.length} 个模型。`);
      } catch (error) {
        if (modelLoadRequestRef.current !== requestId) {
          return;
        }
        setModelOptions([]);
        updateWorkspace({ modelName: "" });
        setStatusMessage(compactError(error));
      } finally {
        if (modelLoadRequestRef.current === requestId) {
          setIsLoadingModels(false);
        }
      }
    },
    [updateWorkspace, workspace.apiKey, workspace.baseUrl]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.theme;
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    let isActive = true;

    loadCaseLibrary()
      .then((data) => {
        if (!isActive) {
          return;
        }
        setCaseLibraryItems(data.cases);
        setCaseLibraryCategories(data.categories);
        setCaseLibraryTotal(data.source.totalCases);
        setSelectedCaseId(data.cases[0]?.id ?? null);
        setCaseLibraryError("");
      })
      .catch(() => {
        if (isActive) {
          setCaseLibraryError("案例库加载失败，请稍后重试。");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsCaseLibraryLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (selectedCaseItem === null || activeView !== "cases") {
      return;
    }

    if (isMobileViewport && !isMobileCaseDetailOpen) {
      return;
    }

    if (casePromptsById[selectedCaseItem.id]?.trim()) {
      return;
    }

    let isActive = true;
    setLoadingCasePromptId(selectedCaseItem.id);

    loadCasePrompt(selectedCaseItem.id)
      .then((prompt) => {
        if (isActive) {
          setCasePromptsById((current) => ({
            ...current,
            [selectedCaseItem.id]: prompt
          }));
        }
      })
      .catch(() => {
        if (isActive) {
          setStatusMessage("案例提示词加载失败，请稍后重试。");
        }
      })
      .finally(() => {
        if (isActive) {
          setLoadingCasePromptId((current) => (current === selectedCaseItem.id ? null : current));
        }
      });

    return () => {
      isActive = false;
    };
  }, [activeView, casePromptsById, isMobileCaseDetailOpen, isMobileViewport, selectedCaseItem]);

  useEffect(() => {
    if (activeView !== "cases") {
      return;
    }

    const viewport = caseGridViewportRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleCaseGridMeasure();
          });

    const handleLayoutChange = () => {
      scheduleCaseGridMeasure();
    };

    viewport?.addEventListener("scroll", handleLayoutChange, { passive: true });
    window.addEventListener("scroll", handleLayoutChange, { passive: true });
    window.addEventListener("resize", handleLayoutChange);
    if (viewport) {
      resizeObserver?.observe(viewport);
    }
    if (caseGridWindowRef.current) {
      resizeObserver?.observe(caseGridWindowRef.current);
    }
    scheduleCaseGridMeasure();

    return () => {
      viewport?.removeEventListener("scroll", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange);
      window.removeEventListener("resize", handleLayoutChange);
      resizeObserver?.disconnect();
      if (caseGridMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(caseGridMeasureFrameRef.current);
        caseGridMeasureFrameRef.current = null;
      }
    };
  }, [activeView, scheduleCaseGridMeasure]);

  useLayoutEffect(() => {
    if (activeView !== "cases") {
      return;
    }

    resetCaseGridWindow();
    scheduleCaseGridMeasure();
  }, [
    activeView,
    caseLibraryItems.length,
    caseLibraryQuery,
    resetCaseGridWindow,
    scheduleCaseGridMeasure,
    selectedCaseCategory
  ]);

  useEffect(() => {
    if (activeView === "cases") {
      scheduleCaseGridMeasure();
    }
  }, [activeView, scheduleCaseGridMeasure, visibleCaseLibrary.length]);

  useEffect(() => {
    let isActive = true;

    loadStoredHistory(HISTORY_LIMIT)
      .then((storedHistory) => {
        if (!isActive) {
          return;
        }
        setHistory(storedHistory);
        setSelectedHistoryId(storedHistory[0]?.id ?? null);
      })
      .catch(() => {
        if (isActive) {
          setStatusMessage("历史记录读取失败，本次仍可继续生成。");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsHistoryLoaded(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHistoryLoaded) {
      return;
    }

    let isActive = true;
    saveStoredHistory(history, HISTORY_LIMIT).catch(() => {
      if (isActive) {
        setStatusMessage("历史记录保存失败，本次图片仍可下载。");
      }
    });

    return () => {
      isActive = false;
    };
  }, [history, isHistoryLoaded]);

  useEffect(() => {
    let isActive = true;

    loadStoredEcommerceHistory(ECOMMERCE_HISTORY_LIMIT)
      .then((storedHistory) => {
        if (isActive) {
          setEcommerceHistory(storedHistory);
        }
      })
      .catch(() => {
        if (isActive) {
          setStatusMessage("电商历史任务库读取失败，本次仍可继续生成。");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsEcommerceHistoryLoaded(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isEcommerceHistoryLoaded) {
      return;
    }

    saveStoredEcommerceHistory(ecommerceHistory, ECOMMERCE_HISTORY_LIMIT).catch(() => {
      setStatusMessage("电商历史保存到本机浏览器失败，本次仍可继续生成。");
    });
  }, [ecommerceHistory, isEcommerceHistoryLoaded]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadModels("auto");
    }, 650);
    return () => window.clearTimeout(timer);
  }, [loadModels]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    if (selectedModel.protocol !== workspace.protocol) {
      updateWorkspace({ protocol: selectedModel.protocol });
    }
  }, [selectedModel, updateWorkspace, workspace.protocol]);

  useEffect(() => {
    if (filteredCaseLibrary.length === 0) {
      setSelectedCaseId(null);
      return;
    }

    setSelectedCaseId((current) =>
      current && filteredCaseLibrary.some((caseItem) => caseItem.id === current) ? current : filteredCaseLibrary[0].id
    );
  }, [filteredCaseLibrary]);

  useEffect(() => {
    if (!isMobileCaseDetailOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileCaseDetailOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileCaseDetailOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    setIsMobileViewport(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
      if (!event.matches) {
        setIsMobileCaseDetailOpen(false);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    setSelectedInputIndex((current) => {
      if (inputImages.length === 0) {
        return 0;
      }
      return Math.min(current, inputImages.length - 1);
    });
  }, [inputImages.length]);

  useEffect(() => {
    if (history.length === 0) {
      setSelectedHistoryId(null);
      return;
    }
    setSelectedHistoryId((current) => (current && history.some((item) => item.id === current) ? current : history[0].id));
  }, [history]);

  const openFilePicker = (nextAction: typeof fileAction) => {
    setFileAction(nextAction);
    fileInputRef.current?.click();
  };

  const addFiles = async (files: File[], action: typeof fileAction) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setStatusMessage("请选择图片文件。");
      return;
    }

    try {
      const selectedImageFiles = imageFiles.slice(0, action.mode === "replace" ? 1 : INPUT_IMAGE_LIMIT);
      const nextImages = await prepareInputImages(selectedImageFiles);
      let updatedImages: InputImage[] = [];
      setInputImages((current) => {
        if (action.mode === "replace" && action.index !== null) {
          const cloned = [...current];
          cloned[action.index] = nextImages[0];
          updatedImages = cloned.filter(Boolean).slice(0, INPUT_IMAGE_LIMIT);
          return updatedImages;
        }
        const remainingSlots = INPUT_IMAGE_LIMIT - current.length;
        updatedImages = [...current, ...nextImages.slice(0, Math.max(0, remainingSlots))];
        return updatedImages;
      });
      const totalOriginalBytes = updatedImages.reduce((sum, image) => sum + image.originalSize, 0);
      setStatusMessage(
        totalOriginalBytes > MAX_TOTAL_INPUT_IMAGE_BYTES
          ? "参考图原图总大小已超过 15MB，请减少图片数量或更换更小的图片后再运行。"
          : `已载入 ${nextImages.length} 张参考图。`
      );
    } catch (error) {
      setStatusMessage(compactError(error));
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    await addFiles(files, fileAction);
  };

  const handleDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    await addFiles(Array.from(event.dataTransfer.files), { mode: "append", index: null });
  };

  const removeInputImage = (index: number) => {
    setInputImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const addEcommerceProductImage = async (files: File[]) => {
    const imageFile = files.find((file) => file.type.startsWith("image/"));
    if (!imageFile) {
      setStatusMessage("请选择商品图片。");
      return;
    }

    try {
      const image = await fileToCompressedInputImage(imageFile);
      setEcommerceProductImage(image);
      setStatusMessage(`已载入商品图：${image.name}。`);
    } catch (error) {
      setStatusMessage(compactError(error));
    }
  };

  const handleEcommerceProductImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    await addEcommerceProductImage(files);
  };

  const handleEcommerceProductImageDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    await addEcommerceProductImage(Array.from(event.dataTransfer.files));
  };

  const updateEcommerceSellingPoint = (index: number, value: string) => {
    setEcommerceCopy((current) => {
      const sellingPoints = [...normalizeEcommerceCopy(current).sellingPoints];
      sellingPoints[index] = value;
      return {
        ...current,
        sellingPoints
      };
    });
  };

  const runEcommerceImageGeneration = async (copy?: ProductCopy) => {
    const productImage = ecommerceProductImage;
    const productTitle = ecommerceProductTitle.trim();
    const apiKey = workspace.apiKey.trim();
    const baseUrl = workspace.baseUrl.trim();
    const textModel = ecommerceTextModel.trim();
    const imageModel = ecommerceImageModel.trim();
    const imageSize = ecommerceImageSize;
    const normalizedCopy = copy ? normalizeEcommerceCopy(copy) : null;

    if (!apiKey) {
      throw new Error("请先在全局设置里填写 API Key。");
    }
    if (!baseUrl) {
      throw new Error("请先在全局设置里填写 Base URL。");
    }
    if (!productTitle) {
      throw new Error("请先填写商品标题。");
    }
    if (!productImage) {
      throw new Error("请先上传商品图。");
    }
    if (!imageModel) {
      throw new Error("请填写图片模型。");
    }
    if (normalizedCopy && !isEcommerceCopyComplete(normalizedCopy)) {
      throw new Error("请先生成或补全三个卖点、长标题和短标题。");
    }

    setEcommerceResults(createEcommerceResultTasks("running", "服务端生成中"));

    const { taskId, task: queuedTask } = await createStoredEcommerceTask({
      apiKey,
      baseUrl,
      textModel,
      imageModel,
      imageSize,
      productImage,
      productTitle,
      copy: normalizedCopy ?? undefined
    });

    setEcommerceHistory((current) => upsertEcommerceHistoryItem(current, queuedTask));
    setStatusMessage(`服务端任务 ${taskId} 已创建，正在轮询生成状态...`);

    let historyItem = queuedTask;
    for (let attempt = 0; attempt < ECOMMERCE_TASK_MAX_POLLS; attempt += 1) {
      await wait(attempt === 0 ? 300 : ECOMMERCE_TASK_POLL_INTERVAL_MS);
      historyItem = await loadStoredEcommerceTask(taskId);
      setEcommerceHistory((current) => upsertEcommerceHistoryItem(current, historyItem));

      if (historyItem.status === "queued") {
        setEcommerceResults(createEcommerceResultTasks("queued", "等待服务端任务"));
      } else if (historyItem.status === "running") {
        setEcommerceResults(createEcommerceResultTasks("running", "服务端生成中"));
      }

      if (isTerminalEcommerceTask(historyItem)) {
        break;
      }
    }

    if (!isTerminalEcommerceTask(historyItem)) {
      throw new Error(`服务端任务 ${taskId} 仍在运行，请稍后从电商历史中刷新查看。`);
    }

    const returnedCopy = normalizeEcommerceCopy(historyItem.productCopy);
    if (isEcommerceCopyComplete(returnedCopy)) {
      setEcommerceCopy(returnedCopy);
    }

    const nextTasks = ECOMMERCE_IMAGE_TASKS.map((task) => {
      const image = historyItem.images.find((candidate) => candidate.type === task.type);
      const imageUrl = image?.imageDataUrl ?? image?.cosUrl ?? "";

      if (image && image.status !== "failed" && imageUrl) {
        return {
          ...task,
          status: "success" as const,
          message: "生成完成",
          prompt: image.prompt,
          imageDataUrl: imageUrl,
          mimeType: image.mimeType ?? "image/png",
          createdAt: image.createdAt,
          historyId: historyItem.id
        };
      }

      return {
        ...task,
        status: "failed" as const,
        message: compactError(image?.error ?? "电商图片生成失败。")
      };
    });

    setEcommerceResults(nextTasks);

    const createdImages = historyItem.images.filter((image) => image.status !== "failed" && (image.imageDataUrl || image.cosUrl));
    if (historyItem.status === "delivery_failed") {
      throw new Error(historyItem.error ?? "电商图片生成完成，但投递到 COS 失败。");
    }
    if (createdImages.length === 0) {
      const firstError = historyItem.images.find((image) => image.status === "failed");
      throw new Error(firstError?.error ?? "电商图片生成失败。");
    }

    setEcommerceHistory((current) => upsertEcommerceHistoryItem(current, historyItem));

    const failedCount = nextTasks.filter((task) => task.status === "failed").length;
    setStatusMessage(
      failedCount > 0
        ? `电商生图完成 ${createdImages.length}/4 张，另有 ${failedCount} 张失败，已写入服务端任务库。`
        : `电商生图完成：服务端任务 ${historyItem.id} 已保存。`
    );
  };

  const runEcommerceGenerate = async () => {
    if (!canGenerateEcommerce) {
      setStatusMessage("请先填写全局 API Key/Base URL，并在电商生图里填写商品标题、商品图、文本模型和图片模型。");
      return;
    }

    setIsEcommerceGenerating(true);
    setEcommerceResults(createEcommerceResultTasks("queued", "等待服务端任务"));
    setStatusMessage("正在创建服务端电商任务...");

    try {
      await runEcommerceImageGeneration();
    } catch (error) {
      setStatusMessage(compactError(error));
    } finally {
      setIsEcommerceGenerating(false);
    }
  };

  const regenerateEcommerceImages = async () => {
    if (!canRegenerateEcommerceImages) {
      setStatusMessage("请先上传商品图，并补全三个卖点、长标题和短标题。");
      return;
    }

    setIsEcommerceGenerating(true);
    setStatusMessage("正在按当前文案重新生成4张图...");

    try {
      const normalizedCopy = normalizeEcommerceCopy(ecommerceCopy);
      setEcommerceCopy(normalizedCopy);
      await runEcommerceImageGeneration(normalizedCopy);
    } catch (error) {
      setStatusMessage(compactError(error));
    } finally {
      setIsEcommerceGenerating(false);
    }
  };

  const buildEcommerceDownloadItems = (images: EcommerceHistoryImage[], meta: Pick<EcommerceHistoryItem, "imageModel" | "imageSize" | "productTitle">) =>
    images
      .filter((image) => image.status !== "failed" && (image.imageDataUrl || image.cosUrl))
      .map((image, index): HistoryItem => ({
        id: `ecommerce-download-${image.type}-${index}-${image.createdAt}`,
        imageDataUrl: image.imageDataUrl ?? image.cosUrl ?? "",
        mimeType: image.mimeType ?? "image/png",
        prompt: image.prompt || meta.productTitle,
        modelName: meta.imageModel,
        protocol: "openai_images",
        aspectRatio: "1:1",
        imageSize: meta.imageSize,
        inputImageNames: [],
        createdAt: image.createdAt
      }));

  const downloadCurrentEcommerceResults = () => {
    const images = ecommerceResults
      .filter((task) => task.status === "success" && task.imageDataUrl)
      .map((task): EcommerceHistoryImage => ({
        type: task.type,
        label: task.label,
        title: task.title,
        name: task.name,
        imageDataUrl: task.imageDataUrl ?? "",
        mimeType: task.mimeType ?? "image/png",
        prompt: task.prompt ?? ecommerceProductTitle,
        createdAt: task.createdAt ?? new Date().toISOString()
      }));

    if (images.length === 0) {
      setStatusMessage("当前没有可打包下载的电商结果。");
      return;
    }

    void downloadHistoryAsZip(
      buildEcommerceDownloadItems(images, {
        imageModel: ecommerceImageModel,
        imageSize: ecommerceImageSize,
        productTitle: ecommerceProductTitle
      })
    ).catch((error) => setStatusMessage(compactError(error)));
    setStatusMessage(`已打包下载 ${images.length} 张电商图片。`);
  };

  const downloadEcommerceHistoryItem = (item: EcommerceHistoryItem) => {
    void downloadHistoryAsZip(
      buildEcommerceDownloadItems(item.images, {
        imageModel: item.imageModel,
        imageSize: item.imageSize,
        productTitle: item.productTitle
      })
    ).catch((error) => setStatusMessage(compactError(error)));
    setStatusMessage(`已打包下载「${item.productTitle}」的 ${item.images.length} 张图片。`);
  };

  const openEcommerceHistoryItem = (item: EcommerceHistoryItem) => {
    setEcommerceProductTitle(item.productTitle);
    setEcommerceCopy(item.productCopy);
    setEcommerceTextModel(item.textModel);
    setEcommerceImageModel(item.imageModel);
    setEcommerceImageSize(item.imageSize);
    setEcommerceResults(
      ECOMMERCE_IMAGE_TASKS.map((task) => {
        const image = item.images.find((candidate) => candidate.type === task.type);
        return image
          ? {
              ...task,
              status: "success" as const,
              message: "来自电商历史任务库",
              prompt: image.prompt,
              imageDataUrl: image.imageDataUrl ?? image.cosUrl ?? "",
              mimeType: image.mimeType ?? "image/png",
              createdAt: image.createdAt,
              historyId: item.id
            }
          : {
              ...task,
              status: "failed" as const,
              message: "这张图未保存在该历史任务中"
            };
      })
    );
    setStatusMessage(`已载入电商历史任务「${item.productTitle}」。`);
  };

  const runGenerate = async () => {
    if (!isInputImageSizeWithinLimit) {
      setStatusMessage("参考图原图总大小已超过 15MB，请减少图片数量或更换更小的图片后再运行。");
      return;
    }

    if (!canGenerate) {
      setStatusMessage("请先填写提示词，并从当前 Base URL 获取模型。");
      return;
    }

    const taskInputs = createGenerationPlan({
      workspace,
      inputImages,
      createId: (index) => `task-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      createRandomSeed: randomSeed
    });

    if (taskInputs.length === 0) {
      setStatusMessage("请至少填写一行有效提示词。");
      return;
    }

    if (!workspace.seedLocked && taskInputs[0]) {
      updateWorkspace({ seed: taskInputs[0].seed });
    }

    const generationProtocol = selectedModel?.protocol ?? resolveProtocolFromModelName(workspace.modelName, workspace.protocol);
    if (selectedModel && selectedModel.protocol !== workspace.protocol) {
      updateWorkspace({ protocol: selectedModel.protocol });
    }

    const parallelism = resolveGenerationParallelism(taskInputs.length);

    setIsGenerating(true);
    setGenerationTasks(
      taskInputs.map((task) => ({
        id: task.id,
        index: task.index,
        status: workspace.promptMode === "queue" && task.index >= parallelism ? "queued" : "running",
        message: workspace.promptMode === "queue" && task.index >= parallelism ? "等待队列" : "正在生成",
        prompt: task.prompt,
        seed: task.seed,
        aspectRatio: task.aspectRatio
      }))
    );
    setStatusMessage(
      workspace.promptMode === "queue"
        ? `队列生成中：共 ${taskInputs.length} 条提示词，并行 ${parallelism} 张。`
        : `正在生成 ${taskInputs.length} 张图片...`
    );

    try {
      const runTask = async (task: (typeof taskInputs)[number]) => {
        setGenerationTasks((current) =>
          current.map((candidate) => (candidate.id === task.id ? { ...candidate, status: "running", message: "正在生成" } : candidate))
        );

        try {
          const result = await generateImage({
            workspace: { ...workspace, protocol: generationProtocol, prompt: task.prompt, aspectRatio: task.aspectRatio },
            inputImages,
            seed: task.seed
          });
          const item: HistoryItem = {
            id: result.id,
            imageDataUrl: result.image.dataUrl,
            mimeType: result.image.mimeType,
            prompt: task.prompt,
            modelName: workspace.modelName,
            protocol: generationProtocol,
            aspectRatio: task.aspectRatio,
            imageSize: workspace.imageSize,
            seed: task.seed,
            inputImageNames: inputImages.map((image) => image.name),
            createdAt: result.createdAt
          };

          setGenerationTasks((current) =>
            current.map((candidate) =>
              candidate.id === task.id
                ? {
                    ...candidate,
                    status: "success",
                    message: "生成完成",
                    imageDataUrl: item.imageDataUrl,
                    mimeType: item.mimeType,
                    createdAt: item.createdAt,
                    historyId: item.id
                  }
                : candidate
            )
          );
          return item;
        } catch (error) {
          const message = compactError(error);
          setGenerationTasks((current) =>
            current.map((candidate) => (candidate.id === task.id ? { ...candidate, status: "failed", message } : candidate))
          );
          throw new Error(message);
        }
      };

      const results = await settleGenerationTasks(taskInputs, runTask, {
        maxAttempts: inputImages.length > 0 ? 2 : 1,
        retryDelayMs: inputImages.length > 0 ? 800 : 0
      });
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<HistoryItem> => result.status === "fulfilled");
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      if (fulfilled.length === 0) {
        throw new Error(rejected.map((item) => compactError(item.reason)).find(Boolean) ?? "生成失败。");
      }

      const createdItems = fulfilled.map((result) => result.value);
      const newestItem = createdItems.at(-1);

      setHistory((current) => [...createdItems.reverse(), ...current].slice(0, HISTORY_LIMIT));
      if (newestItem) {
        setSelectedHistoryId(newestItem.id);
      }

      setStatusMessage(
        rejected.length > 0
          ? `已完成 ${fulfilled.length}/${results.length} 张，另有 ${rejected.length} 张失败。`
          : `生成完成：${fulfilled.length} 张。`
      );
    } catch (error) {
      setStatusMessage(compactError(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const openTaskResult = (task: GenerationTask) => {
    if (task.status === "failed") {
      setStatusMessage(task.message);
      return;
    }

    if (!task.historyId) {
      return;
    }

    setSelectedHistoryId(task.historyId);
  };

  const toggleHistorySelection = (historyId: string) => {
    setSelectedHistoryIds((current) =>
      current.includes(historyId) ? current.filter((item) => item !== historyId) : [...current, historyId]
    );
  };

  const deleteSelectedHistory = () => {
    const targets = new Set(selectedHistoryIds);
    setHistory((current) => current.filter((item) => !targets.has(item.id)));
    setSelectedHistoryIds([]);
    setIsManagingHistory(false);
  };

  const downloadSelectedHistory = () => {
    const targets = new Set(selectedHistoryIds);
    const selectedItems = history.filter((item) => targets.has(item.id));

    if (selectedItems.length === 0) {
      setStatusMessage("请先选择要下载的历史图片。");
      return;
    }

    void downloadHistoryAsZip(selectedItems).catch((error) => setStatusMessage(compactError(error)));
    setStatusMessage(`已打包下载 ${selectedItems.length} 张图片。`);
  };

  const dismissUpdateAnnouncement = useCallback(() => {
    setIsUpdateAnnouncementOpen(false);
    try {
      localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, ANNOUNCEMENT_VERSION);
    } catch {
      // Storage can be unavailable in private or restricted browser sessions.
    }
  }, []);

  const showCaseLibraryFromAnnouncement = () => {
    dismissUpdateAnnouncement();
    openCaseLibraryView();
  };

  const copyAssistantWechat = () => {
    void navigator.clipboard?.writeText("Ctikki888").catch(() => undefined);
    setStatusMessage("小助手微信：Ctikki888");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="https://ctikki.com" target="_blank" rel="noreferrer" aria-label="访问 ctikki.com">
          <span className="brand-mark" aria-hidden="true">
            <img src="/image-studio-icon.svg" alt="" />
          </span>
          <div>
            <p className="eyebrow">Custom generation</p>
            <h1>Image Studio</h1>
          </div>
        </a>

        <div className="topbar-actions">
          <a
            className="topup-button"
            href="https://pay.ldxp.cn/shop/AMTT76KG"
            rel="noreferrer"
            target="_blank"
          >
            <CreditCard size={17} />
            充值
          </a>

          <button
            aria-haspopup="dialog"
            className="community-button"
            onClick={() => setIsAiCommunityOpen(true)}
            type="button"
          >
            <MessageCircle size={17} />
            Ai交流群
          </button>

          <nav className="view-tabs" aria-label="主功能标签">
            <button
              className={activeView === "studio" ? "is-active" : ""}
              onClick={() => setActiveView("studio")}
              type="button"
            >
              <SlidersHorizontal size={16} />
              工作台
            </button>
            <button
              className={activeView === "cases" ? "is-active" : ""}
              onClick={openCaseLibraryView}
              type="button"
            >
              <ImageIcon size={16} />
              案例专区
            </button>
            <button
              className={activeView === "ecommerce" ? "is-active" : ""}
              onClick={openEcommerceView}
              type="button"
            >
              <ShoppingBag size={16} />
              电商生图
            </button>
          </nav>
        </div>

        <p className="status-pill" aria-live="polite">
          {isStatusBusy ? <Loader2 className="spin" size={16} /> : null}
          <span className="status-text">{visibleStatusMessage}</span>
        </p>

        <button
          aria-label={workspace.theme === "light" ? "切换深色主题" : "切换浅色主题"}
          className="icon-button"
          onClick={() => updateWorkspace({ theme: workspace.theme === "light" ? "dark" : "light" })}
          title={workspace.theme === "light" ? "深色" : "浅色"}
          type="button"
        >
          {workspace.theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>

      {activeView === "studio" ? (
        <section className={`motion-console ${isGenerating ? "is-live" : ""}`} aria-label="创意引擎状态">
          <div className="motion-console-signal" aria-hidden="true">
            <span />
          </div>
          <div className="motion-console-copy">
            <span>Creative engine</span>
            <strong>{isGenerating ? "正在把提示词推入生成队列" : "准备生成下一组画面"}</strong>
          </div>
          <dl className="motion-console-stats" aria-label="当前生成设置">
            <div>
              <dt>Tasks</dt>
              <dd>{String(plannedTaskCount).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>Frame</dt>
              <dd>{effectiveAspectRatio === "Adaptive" ? "自动" : effectiveAspectRatio}</dd>
            </div>
            <div>
              <dt>Quality</dt>
              <dd>{workspace.imageSize}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {activeView === "studio" ? (
      <div className={`workbench-shell ${isHistorySidebarOpen ? "is-history-open" : ""}`}>
      <main className="workbench" aria-label="Image Studio 工作台">
        <section className="panel params-panel" aria-label="参数">
          <div className="section-heading">
            <span>01</span>
            <h2>参数</h2>
          </div>

          <label className="field">
            <span>API Key</span>
            <div className="inline-control">
              <input
                autoComplete="off"
                onChange={(event) => updateWorkspace({ apiKey: event.currentTarget.value })}
                placeholder="sk-..."
                type={isApiKeyVisible ? "text" : "password"}
                value={workspace.apiKey}
              />
              <button
                aria-label={isApiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                className="icon-button control-button"
                onClick={() => setIsApiKeyVisible((current) => !current)}
                type="button"
              >
                {isApiKeyVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <label className="field">
            <span>提示词</span>
            <textarea
              onChange={(event) => updateWorkspace({ prompt: event.currentTarget.value })}
              placeholder={
                workspace.promptMode === "queue"
                  ? "一行一个提示词，例如：\n电商主图\n侧身姿势图\n细节特写图"
                  : "请输入你想生成或修改的内容"
              }
              value={workspace.prompt}
            />
            <span className="field-hint">
              {workspace.promptMode === "queue"
                ? promptQueue.length > MAX_GENERATION_COUNT
                  ? `已识别 ${promptQueue.length} 条提示词，本次执行前 ${MAX_GENERATION_COUNT} 条。`
                  : `已识别 ${promptQueue.length} 条提示词。`
                : "同一个提示词可一次生成多张。"}
            </span>
          </label>

          <div className="segmented-control" role="group" aria-label="生成模式">
            <button
              className={workspace.promptMode === "count" ? "is-active" : ""}
              onClick={() => updateWorkspace({ promptMode: "count" })}
              type="button"
            >
              同提示词 N 张
            </button>
            <button
              className={workspace.promptMode === "queue" ? "is-active" : ""}
              onClick={() => updateWorkspace({ promptMode: "queue" })}
              type="button"
            >
              多提示词队列
            </button>
          </div>

          <label className="field">
            <span>Base URL</span>
            <input
              onChange={(event) => updateWorkspace({ baseUrl: event.currentTarget.value, modelName: "" })}
              placeholder={DEFAULT_BASE_URL}
              type="url"
              value={workspace.baseUrl}
            />
          </label>

          <label className="field">
            <span>模型</span>
            <div className="inline-control model-control">
              <select
                disabled={isLoadingModels || modelOptions.length === 0}
                onChange={(event) => {
                  const model = modelOptions.find((item) => item.id === event.currentTarget.value);
                  if (!model) {
                    return;
                  }
                  updateWorkspace({ modelName: model.id, protocol: model.protocol });
                }}
                value={workspace.modelName}
              >
                {isLoadingModels ? <option value="">正在获取模型...</option> : null}
                {!isLoadingModels && modelOptions.length === 0 ? <option value="">未获取到模型</option> : null}
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
              <button
                aria-label="刷新模型列表"
                className="icon-button control-button"
                disabled={isLoadingModels || !workspace.baseUrl.trim()}
                onClick={() => void loadModels("manual")}
                title="刷新模型列表"
                type="button"
              >
                <RefreshCw className={isLoadingModels ? "spin" : ""} size={18} />
              </button>
            </div>
          </label>

          <div className="field-row compact-setting-row">
            <label className="field">
              <span>比例</span>
              <select
                onChange={(event) => updateWorkspace({ aspectRatio: event.currentTarget.value as AspectRatio })}
                value={workspace.aspectRatio}
              >
                {ASPECT_RATIO_OPTIONS.map((ratio) => (
                  <option key={ratio.value} value={ratio.value}>
                    {ratio.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>画质</span>
              <select
                onChange={(event) => updateWorkspace({ imageSize: event.currentTarget.value as ImageSize })}
                value={workspace.imageSize}
              >
                {IMAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <span className="field-hint compact-setting-hint">
              {workspace.aspectRatio === "Adaptive"
                ? effectiveAspectRatio === "Adaptive"
                  ? "自动：未上传参考图时由上游决定比例。"
                  : `自动：跟随第一张参考图，按 ${effectiveAspectRatio} 生成。`
                : "手动比例会优先生效。"}
            </span>
          </div>

          <div className="field-row single-field-row">
            <label className="field">
              <span>{workspace.promptMode === "queue" ? "队列条数" : "数量"}</span>
              <input
                disabled={workspace.promptMode === "queue"}
                max={MAX_GENERATION_COUNT}
                min={workspace.promptMode === "queue" ? 0 : 1}
                onChange={(event) =>
                  updateWorkspace({
                    concurrency: Math.min(MAX_GENERATION_COUNT, Math.max(1, Number.parseInt(event.currentTarget.value, 10) || 1))
                  })
                }
                type="number"
                value={workspace.promptMode === "queue" ? plannedTaskCount : workspace.concurrency}
              />
              <span className="field-hint">
                {workspace.promptMode === "queue"
                  ? promptQueue.length > MAX_GENERATION_COUNT
                    ? `队列模式最多执行前 ${MAX_GENERATION_COUNT} 条，并发 ${MAX_GENERATION_COUNT} 个任务。`
                    : `队列模式会同时生成 ${plannedTaskCount} 个任务。`
                  : `本次会创建并并发 ${plannedTaskCount} 个生成任务。`}
              </span>
            </label>
          </div>

          <div className="advanced-box">
            <button className="advanced-toggle" onClick={() => setIsAdvancedOpen((current) => !current)} type="button">
              <span>
                <SlidersHorizontal size={16} />
                高级参数
              </span>
              <small>{workspace.seedLocked ? `Seed ${workspace.seed}` : "随机 Seed"}</small>
            </button>

            {isAdvancedOpen ? (
              <div className="advanced-content">
                <label className="field">
                  <span>Seed</span>
                  <div className="inline-control">
                    <input
                      min={0}
                      onChange={(event) =>
                        updateWorkspace({ seed: Math.max(0, Number.parseInt(event.currentTarget.value, 10) || 0) })
                      }
                      type="number"
                      value={workspace.seed}
                    />
                    <button
                      aria-label={workspace.seedLocked ? "解除 Seed 锁定" : "锁定 Seed"}
                      className={`icon-button control-button ${workspace.seedLocked ? "is-active" : ""}`}
                      onClick={() => updateWorkspace({ seedLocked: !workspace.seedLocked })}
                      title={workspace.seedLocked ? "已锁定 Seed" : "使用随机 Seed"}
                      type="button"
                    >
                      {workspace.seedLocked ? <Lock size={17} /> : <Unlock size={17} />}
                    </button>
                  </div>
                  <span className="field-hint">
                    {workspace.seedLocked
                      ? "锁定后批量任务会使用 seed、seed+1、seed+2，方便复现系列图。"
                      : "未锁定时每次运行会自动生成新的起始 seed。"}
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <button className="run-button" disabled={!canGenerate} onClick={() => void runGenerate()} type="button">
            {isGenerating ? <Loader2 className="spin" size={20} /> : <Play size={20} />}
            运行
          </button>
        </section>

        <section className="panel upload-panel" aria-label="上传图像">
          <div className="section-heading">
            <span>02</span>
            <h2>参考图</h2>
          </div>

          <input
            accept="image/*"
            className="visually-hidden"
            multiple={fileAction.mode === "append"}
            onChange={(event) => void handleFileChange(event)}
            ref={fileInputRef}
            type="file"
          />

          <button
            className={`upload-dropzone ${selectedInputImage ? "has-image" : ""}`}
            onClick={() =>
              openFilePicker({
                mode: selectedInputImage ? "replace" : "append",
                index: selectedInputImage ? selectedInputIndex : null
              })
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDrop(event)}
            type="button"
          >
            {selectedInputImage ? (
              <img alt={selectedInputImage.name} src={selectedInputImage.dataUrl} />
            ) : (
              <div className="empty-upload">
                <UploadCloud size={34} />
                <strong>上传参考图</strong>
                <span>最多 {INPUT_IMAGE_LIMIT} 张</span>
              </div>
            )}
          </button>

          <div className="preview-row">
            {inputImages.map((image, index) => (
              <button
                aria-label={`选择 ${image.name}`}
                className={`preview-tile ${index === selectedInputIndex ? "is-active" : ""}`}
                key={image.id}
                onClick={() => setSelectedInputIndex(index)}
                type="button"
              >
                <img alt="" src={image.dataUrl} />
                <span className="preview-index">{index + 1}</span>
                <span className="preview-meta">{readableSize(image.size)}</span>
                <span
                  aria-label={`删除 ${image.name}`}
                  className="tile-delete"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removeInputImage(index);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <X size={14} />
                </span>
              </button>
            ))}
            <button
              aria-label="添加参考图"
              className="add-tile"
              disabled={inputImages.length >= INPUT_IMAGE_LIMIT}
              onClick={() => openFilePicker({ mode: "append", index: null })}
              type="button"
            >
              <Plus size={22} />
            </button>
          </div>

          <span className={`field-hint upload-size-hint ${isInputImageSizeWithinLimit ? "" : "is-over-limit"}`}>
            当前原图总大小 {readableSize(totalOriginalInputImageBytes)} / 15MB
            {isInputImageSizeWithinLimit ? "。" : "，已超过上限，请减少参考图后再运行。"}
          </span>
        </section>

        <section className="output-region" aria-label="结果">
          <div className="panel output-panel">
            <div className="section-heading">
              <span>03</span>
              <h2>结果</h2>
            </div>

            {generationTasks.length > 0 ? (
              <div className="generation-task-grid" aria-label="生成任务">
                {generationTasks.map((task) => (
                  <button
                    className={`generation-task-card is-${task.status}`}
                    disabled={task.status === "queued" || task.status === "running"}
                    key={task.id}
                    onClick={() => openTaskResult(task)}
                    title={task.status === "failed" ? task.message : undefined}
                    type="button"
                  >
                    <span className="generation-task-index">{String(task.index + 1).padStart(2, "0")}</span>
                    <span className="generation-task-preview">
                      {task.imageDataUrl ? (
                        <img alt="" src={task.imageDataUrl} />
                      ) : task.status === "failed" ? (
                        <X size={22} />
                      ) : task.status === "queued" ? (
                        <span className="queued-dot" />
                      ) : (
                        <Loader2 className="spin" size={22} />
                      )}
                    </span>
                    <span className="generation-task-copy">
                      <strong>
                        {task.status === "success" ? "已完成" : task.status === "failed" ? "生成失败" : task.status === "queued" ? "排队中" : "生成中"}
                        {task.status === "success" ? <CheckCircle2 size={14} /> : null}
                      </strong>
                      <small>
                        {task.status === "failed" ? task.message : task.prompt ? `${task.message} · ${task.prompt}` : task.message}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {visibleHistoryItem ? (
              <div className="output-content">
                <div className="output-image-frame">
                  <img alt={visibleHistoryItem.prompt} src={visibleHistoryItem.imageDataUrl} />
                </div>
                <div className="output-actions">
                  <div>
                    <strong>{visibleHistoryItem.modelName}</strong>
                    <span>{formatTime(visibleHistoryItem.createdAt)}</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      downloadDataUrl({
                        dataUrl: visibleHistoryItem.imageDataUrl,
                        mimeType: visibleHistoryItem.mimeType,
                        createdAt: visibleHistoryItem.createdAt
                      })
                    }
                    type="button"
                  >
                    <Download size={17} />
                    下载
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-output">
                <ImageIcon size={42} />
                <strong>等待生成</strong>
              </div>
            )}
          </div>

        </section>
      </main>
      <button
        aria-controls="history-sidebar"
        aria-expanded={isHistorySidebarOpen}
        aria-label={isHistorySidebarOpen ? "关闭历史侧边栏" : "打开历史侧边栏"}
        className="history-toggle-button"
        onClick={() => {
          if (isHistorySidebarOpen) {
            setIsManagingHistory(false);
          }
          setIsHistorySidebarOpen((current) => !current);
        }}
        title={isHistorySidebarOpen ? "关闭历史" : "打开历史"}
        type="button"
      >
        {isHistorySidebarOpen ? <X size={17} /> : <ImageIcon size={17} />}
        <span>历史</span>
      </button>
      <aside
        aria-hidden={!isHistorySidebarOpen}
        aria-label="历史记录"
        className={`panel history-panel history-sidebar ${isHistorySidebarOpen ? "is-open" : ""}`}
        id="history-sidebar"
      >
        <div className={`history-head ${isManagingHistory ? "is-managing" : ""}`}>
          <div className="history-title-row">
            <div className="history-title">
              <h2>历史</h2>
              <span>{isManagingHistory ? `已选 ${selectedHistoryIds.length}` : isHistoryLoaded ? `${history.length} 张` : "读取中"}</span>
            </div>
            {!isManagingHistory ? (
              <button className="text-button small" onClick={() => setIsManagingHistory(true)} type="button">
                管理
              </button>
            ) : null}
          </div>
          {isManagingHistory ? (
            <div className="history-actions" aria-label="历史批量操作">
              <button
                aria-label="下载选中"
                className="icon-button control-button"
                disabled={selectedHistoryIds.length === 0}
                onClick={downloadSelectedHistory}
                title="下载选中"
                type="button"
              >
                <Download size={17} />
              </button>
              <button
                className="icon-button control-button"
                disabled={selectedHistoryIds.length === 0}
                onClick={deleteSelectedHistory}
                title="删除选中"
                type="button"
              >
                <Trash2 size={17} />
              </button>
              <button className="icon-button control-button" onClick={() => setIsManagingHistory(false)} title="完成" type="button">
                <X size={17} />
              </button>
            </div>
          ) : null}
        </div>

        <div className="history-list">
          {!isHistoryLoaded ? (
            <div className="empty-history">正在读取历史</div>
          ) : history.length === 0 ? (
            <div className="empty-history">暂无记录</div>
          ) : (
            history.map((item) => (
              <button
                aria-label={`查看 ${formatTime(item.createdAt)}`}
                className={`history-tile ${item.id === visibleHistoryItem?.id ? "is-active" : ""} ${
                  selectedHistoryIds.includes(item.id) ? "is-selected" : ""
                }`}
                key={item.id}
                onClick={() => {
                  if (isManagingHistory) {
                    toggleHistorySelection(item.id);
                    return;
                  }
                  setSelectedHistoryId(item.id);
                }}
                type="button"
              >
                <img alt="" src={item.imageDataUrl} />
                <span>{formatTime(item.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      </aside>
      </div>
      ) : activeView === "ecommerce" ? (
        <main className="ecommerce-page" aria-label="电商生图">
          <section className="panel ecommerce-panel ecommerce-input-panel" aria-label="电商商品信息">
            <div className="section-heading">
              <span>01</span>
              <h2>商品信息</h2>
            </div>

            <div className="ecommerce-connection">
              <span>全局 Base URL</span>
              <strong>{workspace.baseUrl.trim() || DEFAULT_BASE_URL}</strong>
            </div>

            <label className="field">
              <span>商品标题</span>
              <input
                onChange={(event) => setEcommerceProductTitle(event.currentTarget.value)}
                placeholder="例如：山茶花补水面霜女保湿修护"
                value={ecommerceProductTitle}
              />
            </label>

            <div className="field">
              <span>商品图</span>
              <input
                accept="image/*"
                className="visually-hidden"
                onChange={(event) => void handleEcommerceProductImageChange(event)}
                ref={ecommerceFileInputRef}
                type="file"
              />
              <button
                className={`upload-dropzone ecommerce-product-dropzone ${ecommerceProductImage ? "has-image" : ""}`}
                onClick={() => ecommerceFileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void handleEcommerceProductImageDrop(event)}
                type="button"
              >
                {ecommerceProductImage ? (
                  <img alt={ecommerceProductImage.name} src={ecommerceProductImage.dataUrl} />
                ) : (
                  <div className="empty-upload">
                    <UploadCloud size={34} />
                    <strong>上传商品底图</strong>
                    <span>白底图或随手拍都可以</span>
                  </div>
                )}
              </button>
              {ecommerceProductImage ? (
                <div className="ecommerce-file-row">
                  <span>{ecommerceProductImage.name}</span>
                  <button className="text-button small" onClick={() => setEcommerceProductImage(null)} type="button">
                    移除
                  </button>
                </div>
              ) : null}
            </div>

            <div className="field-row">
              <label className="field">
                <span>文本模型</span>
                <select
                  disabled={isEcommerceGenerating}
                  onChange={(event) => setEcommerceTextModel(event.currentTarget.value)}
                  value={ecommerceTextModel}
                >
                  {isLoadingModels ? <option value={ecommerceTextModel}>正在获取模型...</option> : null}
                  {!isLoadingModels && ecommerceTextModelOptions.length === 0 ? <option value="">未获取到文本模型</option> : null}
                  {!isLoadingModels
                    ? ecommerceTextModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                        </option>
                      ))
                    : null}
                </select>
              </label>
              <label className="field">
                <span>图片模型</span>
                <select
                  disabled={isEcommerceGenerating}
                  onChange={(event) => setEcommerceImageModel(event.currentTarget.value)}
                  value={ecommerceImageModel}
                >
                  {isLoadingModels ? <option value={ecommerceImageModel}>正在获取模型...</option> : null}
                  {!isLoadingModels && ecommerceImageModelOptions.length === 0 ? <option value="">未获取到图片模型</option> : null}
                  {!isLoadingModels
                    ? ecommerceImageModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                        </option>
                      ))
                    : null}
                </select>
              </label>
            </div>

            <label className="field">
              <span>画质</span>
              <select
                disabled={isEcommerceGenerating}
                onChange={(event) => setEcommerceImageSize(event.currentTarget.value as ImageSize)}
                value={ecommerceImageSize}
              >
                {IMAGE_SIZES.slice().reverse().map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span className="field-hint">电商生图固定正方形，默认 1K；画质越高生成越慢。</span>
            </label>

            <button className="run-button" disabled={!canGenerateEcommerce} onClick={() => void runEcommerceGenerate()} type="button">
              {isEcommerceGenerating ? <Loader2 className="spin" size={20} /> : <Play size={20} />}
              一键生成
            </button>
          </section>

          <section className="panel ecommerce-panel ecommerce-copy-panel" aria-label="电商文案">
            <div className="section-heading">
              <span>02</span>
              <h2>卖点与标题</h2>
            </div>

            <div className="ecommerce-copy-grid">
              {ecommerceCopy.sellingPoints.map((point, index) => (
                <label className="field" key={index}>
                  <span>卖点 {index + 1}</span>
                  <input
                    onChange={(event) => updateEcommerceSellingPoint(index, event.currentTarget.value)}
                    placeholder={index === 0 ? "高转化短卖点" : "继续补充卖点"}
                    value={point}
                  />
                </label>
              ))}
            </div>

            <label className="field">
              <span>长标题</span>
              <textarea
                className="ecommerce-title-textarea"
                onChange={(event) => setEcommerceCopy((current) => ({ ...current, longTitle: event.currentTarget.value }))}
                placeholder="生成后可在这里微调长标题"
                value={ecommerceCopy.longTitle}
              />
            </label>

            <label className="field">
              <span>短标题</span>
              <input
                onChange={(event) => setEcommerceCopy((current) => ({ ...current, shortTitle: event.currentTarget.value }))}
                placeholder="适合放在结果卡片或图上"
                value={ecommerceCopy.shortTitle}
              />
            </label>

            <button
              className="text-button ecommerce-regenerate-button"
              disabled={!canRegenerateEcommerceImages}
              onClick={() => void regenerateEcommerceImages()}
              type="button"
            >
              <RefreshCw className={isEcommerceGenerating ? "spin" : ""} size={17} />
              重新生成4张图
            </button>
          </section>

          <section className="panel ecommerce-panel ecommerce-output-panel" aria-label="电商生成结果">
            <div className="ecommerce-panel-head">
              <div className="section-heading">
                <span>03</span>
                <h2>本次结果</h2>
              </div>
              <button className="text-button" onClick={downloadCurrentEcommerceResults} type="button">
                <Download size={17} />
                打包下载本组
              </button>
            </div>

            <div className="ecommerce-results-grid">
              {ecommerceResults.map((task) => (
                <article className={`ecommerce-result-card is-${task.status}`} key={task.type}>
                  <div className="ecommerce-result-preview">
                    {task.imageDataUrl ? (
                      <img alt={task.label} src={task.imageDataUrl} />
                    ) : task.status === "failed" ? (
                      <X size={30} />
                    ) : task.status === "running" ? (
                      <Loader2 className="spin" size={30} />
                    ) : (
                      <ImageIcon size={30} />
                    )}
                  </div>
                  <div className="ecommerce-result-body">
                    <strong>{task.label}</strong>
                    <span>{task.status === "success" ? "已写入电商历史任务库" : task.message}</span>
                  </div>
                  {task.imageDataUrl ? (
                    <div className="ecommerce-result-actions">
                      <button
                        className="text-button small"
                        onClick={() =>
                          downloadDataUrl({
                            dataUrl: task.imageDataUrl ?? "",
                            mimeType: task.mimeType ?? "image/png",
                            createdAt: task.createdAt
                          })
                        }
                        type="button"
                      >
                        <Download size={15} />
                        下载
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="panel ecommerce-panel ecommerce-history-panel" aria-label="电商历史任务库">
            <div className="ecommerce-panel-head">
              <div className="section-heading">
                <span>04</span>
                <h2>电商历史</h2>
              </div>
              <span className="ecommerce-history-count">
                {isEcommerceHistoryLoaded ? `${ecommerceHistory.length} 组任务` : "读取中"}
              </span>
            </div>

            {!isEcommerceHistoryLoaded ? (
              <div className="empty-history">正在读取电商历史任务库</div>
            ) : ecommerceHistory.length === 0 ? (
              <div className="empty-history">暂无电商历史任务</div>
            ) : (
              <div className="ecommerce-history-list">
                {ecommerceHistory.map((item) => (
                  <article className="ecommerce-history-card" key={item.id}>
                    <button className="ecommerce-history-card-main" onClick={() => openEcommerceHistoryItem(item)} type="button">
                      <strong>{item.productTitle}</strong>
                      <span>
                        {formatTime(item.createdAt)} · {item.imageSize} · {item.images.length} 张
                      </span>
                    </button>
                    <button className="text-button small" onClick={() => downloadEcommerceHistoryItem(item)} type="button">
                      <Download size={15} />
                      打包下载
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="case-library-page" aria-label="案例专区">
          <section className="case-library-main" aria-label="案例浏览">
            <div className="case-library-hero">
              <div>
                <p className="eyebrow">Prompt gallery</p>
                <h2>案例专区</h2>
                <p>
                  收录 {CASE_LIBRARY_SOURCE.name} 画廊案例，点击卡片查看详情，一键复制提示词或套用到生图工作台。
                </p>
              </div>
              <a className="case-source-link" href={CASE_LIBRARY_SOURCE.sourceRepository} rel="noreferrer" target="_blank">
                GitHub 项目
                <ExternalLink size={16} />
              </a>
            </div>

            <div className="case-library-toolbar">
              <label className="case-search" aria-label="搜索案例">
                <Search size={18} />
                <input
                  onChange={(event) => setCaseLibraryQuery(event.currentTarget.value)}
                  placeholder="搜索案例、提示词、来源..."
                  type="search"
                  value={caseLibraryQuery}
                />
              </label>
              <div className="case-count">
                <strong>{filteredCaseLibrary.length}</strong>
                <span>/ {caseLibraryTotal || caseLibraryItems.length} 个案例</span>
              </div>
            </div>

            <div className="case-category-row" aria-label="案例分类">
              {[ALL_CASE_CATEGORY, ...caseLibraryCategories].map((category) => (
                <button
                  className={selectedCaseCategory === category ? "is-active" : ""}
                  key={category}
                  onClick={() => setSelectedCaseCategory(category)}
                  type="button"
                >
                  {category === ALL_CASE_CATEGORY ? ALL_CASE_CATEGORY : localizeCaseCategory(category)}
                </button>
              ))}
            </div>

            {isCaseLibraryLoading ? (
              <div className="empty-case-library">
                <Loader2 className="spin" size={34} />
                <strong>正在加载案例库</strong>
                <span>读取 awesome-gpt-image-2 的完整案例数据。</span>
              </div>
            ) : caseLibraryError ? (
              <div className="empty-case-library">
                <X size={34} />
                <strong>{caseLibraryError}</strong>
                <span>请确认本地 /cases-index.json 可以访问。</span>
              </div>
            ) : filteredCaseLibrary.length > 0 ? (
              <div className="case-library-grid-viewport" ref={caseGridViewportRef}>
                <div className="case-library-grid-spacer" style={{ height: `${caseGridVisibleWindow.totalHeight}px` }}>
                  <div
                    className="case-library-grid case-library-grid-window"
                    ref={caseGridWindowRef}
                    style={{ transform: `translateY(${caseGridVisibleWindow.offsetY}px)` }}
                  >
                    {visibleCaseLibrary.map((caseItem, index) => {
                      const caseIndex = caseGridVisibleWindow.startIndex + index;
                      const imageState = caseImageLoadState[caseItem.id] ?? "loading";
                      return (
                        <button
                          className={`case-card ${selectedCaseItem?.id === caseItem.id ? "is-active" : ""}`}
                          key={caseItem.id}
                          onClick={() => openCaseDetail(caseItem.id)}
                          ref={index === 0 ? firstCaseCardRef : null}
                          type="button"
                        >
                          <span className={`case-image-wrap is-${imageState}`}>
                            <img
                              alt={caseItem.imageAlt}
                              decoding="async"
                              fetchPriority={caseIndex < 4 ? "high" : "auto"}
                              loading="lazy"
                              onError={() => markCaseImageState(caseItem.id, "failed")}
                              onLoad={() => markCaseImageState(caseItem.id, "loaded")}
                              ref={(node) => {
                                if (!node || imageState !== "loading" || !node.complete) {
                                  return;
                                }
                                markCaseImageState(caseItem.id, node.naturalWidth > 0 ? "loaded" : "failed");
                              }}
                              src={caseItem.thumbImage}
                            />
                            {imageState === "failed" ? (
                              <span className="case-image-fallback">
                                <ImageIcon size={22} />
                                预览加载失败
                              </span>
                            ) : null}
                            <span className="case-image-index">#{caseItem.id}</span>
                          </span>
                          <span className="case-card-body">
                            <strong>{caseItem.title}</strong>
                            <small>{localizeCaseCategory(caseItem.category)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-case-library">
                <Search size={34} />
                <strong>没有找到匹配案例</strong>
                <span>换个关键词或分类试试。</span>
              </div>
            )}
          </section>

          <aside className="case-library-detail" aria-label="案例详情">
            {selectedCaseItem ? (
              <CaseLibraryDetailPanel
                canUsePrompt={canUseSelectedCasePrompt}
                caseItem={selectedCaseItem}
                copiedCaseId={copiedCaseId}
                isCasePromptLoading={isCasePromptLoading}
                onApply={applyCasePrompt}
                onCopy={copyCasePrompt}
                prompt={selectedCasePrompt}
              />
            ) : (
              <div className="empty-case-detail">
                <ImageIcon size={36} />
                <strong>选择一个案例</strong>
                <span>点击左侧卡片查看提示词和生成入口。</span>
              </div>
            )}
          </aside>
        </main>
      )}

      {activeView === "cases" && selectedCaseItem && isMobileCaseDetailOpen ? (
        <div
          className="case-detail-sheet-backdrop"
          onClick={() => setIsMobileCaseDetailOpen(false)}
          role="presentation"
        >
          <section
            aria-label="案例移动端详情"
            className="case-detail-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <CaseLibraryDetailPanel
              canUsePrompt={canUseSelectedCasePrompt}
              caseItem={selectedCaseItem}
              copiedCaseId={copiedCaseId}
              headerAction={
                <button
                  aria-label="关闭案例详情"
                  className="icon-button case-detail-sheet-close"
                  onClick={() => setIsMobileCaseDetailOpen(false)}
                  type="button"
                >
                  <X size={18} />
                </button>
              }
              isCasePromptLoading={isCasePromptLoading}
              onApply={applyCasePrompt}
              onCopy={copyCasePrompt}
              prompt={selectedCasePrompt}
            />
          </section>
        </div>
      ) : null}

      {isAiCommunityOpen ? (
        <div className="ai-community-backdrop" onClick={() => setIsAiCommunityOpen(false)} role="presentation">
          <section
            aria-labelledby="ai-community-title"
            aria-modal="true"
            className="ai-community-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="关闭 Ai 交流群"
              className="icon-button ai-community-close"
              onClick={() => setIsAiCommunityOpen(false)}
              type="button"
            >
              <X size={18} />
            </button>
            <p className="ai-community-kicker">Image Studio Community</p>
            <h2 id="ai-community-title">Ai交流群</h2>
            <p className="ai-community-copy">
              添加小助手申请入群 vx:<strong>Ctikki888</strong>
            </p>
            <div className="ai-community-qr">
              <img alt="Ai小助手微信二维码" src="/ai-community-qr.jpg" />
            </div>
            <button className="release-announcement-secondary" onClick={copyAssistantWechat} type="button">
              <Copy size={16} />
              复制微信号
            </button>
          </section>
        </div>
      ) : null}

      {isUpdateAnnouncementOpen ? (
        <div className="release-announcement-backdrop" onClick={dismissUpdateAnnouncement} role="presentation">
          <section
            aria-labelledby="release-announcement-title"
            aria-modal="true"
            className="release-announcement-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="关闭更新公告"
              className="icon-button release-announcement-close"
              onClick={dismissUpdateAnnouncement}
              type="button"
            >
              <X size={18} />
            </button>
            <p className="release-announcement-kicker">Image Studio Release</p>
            <h2 id="release-announcement-title">5.20更新公告</h2>
            <div className="release-announcement-copy">
              <p>
                接入了全球最强生图模型 <strong>gptimage2</strong>，收集了全网{" "}
                <strong>442 条玩法案例</strong>，一键复刻，立即赚钱。
              </p>
              <p>
                欢迎大家反馈 bug 或提供优化意见，联系小助手 VX：<strong>Ctikki888</strong>{" "}
                加群一起交流。
              </p>
            </div>
            <div className="release-announcement-actions">
              <button className="release-announcement-primary" onClick={showCaseLibraryFromAnnouncement} type="button">
                查看玩法案例
              </button>
              <button className="release-announcement-secondary" onClick={copyAssistantWechat} type="button">
                <Copy size={16} />
                复制微信
              </button>
              <button className="release-announcement-secondary" onClick={dismissUpdateAnnouncement} type="button">
                我知道了
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
