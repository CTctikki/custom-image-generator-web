import type {
  EcommerceImageGenerationResult,
  GenerateEcommerceImagesInput,
  GenerateProductCopyInput,
  ProductCopy
} from "../../src/ecommerceGeneration.js";
import type { ImageSize, InputImage } from "../../src/types.js";

export type EcommerceTaskStatus = "queued" | "running" | "completed" | "delivery_failed" | "failed";
export type EcommerceStoredImageStatus = "success" | "failed";

export interface EcommerceCost {
  amount: number | null;
  currency: string | null;
  detail?: Record<string, unknown>;
}

export interface StoredObject {
  objectKey: string;
  cosUrl: string;
}

export interface PutObjectInput {
  objectKey: string;
  mimeType: string;
  body: Buffer;
  metadata?: Record<string, string>;
}

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<StoredObject>;
}

export interface EcommerceProductImageRecord {
  name: string;
  mimeType: string;
  objectKey: string | null;
  cosUrl: string | null;
  size: number;
  width?: number;
  height?: number;
}

export interface EcommerceTaskImageRecord {
  type: string;
  label: string;
  title: string;
  name: string;
  prompt: string;
  mimeType: string | null;
  objectKey: string | null;
  cosUrl: string | null;
  createdAt: string;
  status: EcommerceStoredImageStatus;
  error?: string;
  cost: EcommerceCost | null;
}

export interface EcommerceTaskRecord {
  id: string;
  productTitle: string;
  productImageName: string;
  productImage: EcommerceProductImageRecord;
  productCopy: ProductCopy | null;
  textModel: string;
  imageModel: string;
  imageSize: ImageSize;
  status: EcommerceTaskStatus;
  error?: string;
  cost: EcommerceCost | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  images: EcommerceTaskImageRecord[];
}

export interface CreateEcommerceTaskInput {
  apiKey: string;
  baseUrl: string;
  productTitle: string;
  productImage: InputImage;
  textModel: string;
  imageModel: string;
  imageSize: ImageSize;
  copy?: ProductCopy;
  userId?: string | null;
}

export interface ListEcommerceTasksInput {
  limit: number;
  userId?: string | null;
}

export interface ClaimQueuedEcommerceTaskInput {
  workerId: string;
  now: Date;
  staleAfterMs: number;
}

export interface ClaimedEcommerceTask {
  task: EcommerceTaskRecord;
  input: CreateEcommerceTaskInput;
}

export interface EcommerceTaskRepository {
  create(task: EcommerceTaskRecord): Promise<EcommerceTaskRecord>;
  update(task: EcommerceTaskRecord): Promise<EcommerceTaskRecord>;
  getById(id: string, userId?: string | null): Promise<EcommerceTaskRecord | null>;
  list(limit: number, userId?: string | null): Promise<EcommerceTaskRecord[]>;
  enqueueTaskInput(taskId: string, input: CreateEcommerceTaskInput): Promise<void>;
  claimNextQueuedTask(input: ClaimQueuedEcommerceTaskInput): Promise<ClaimedEcommerceTask | null>;
  completeQueuedTask(taskId: string, status: EcommerceTaskStatus): Promise<void>;
}

export interface EcommerceServiceDependencies {
  repository?: EcommerceTaskRepository;
  storage?: ObjectStorage;
  now?: () => Date;
  createId?: () => string;
  generateCopy?: (input: GenerateProductCopyInput) => Promise<ProductCopy>;
  generateImages?: (input: GenerateEcommerceImagesInput) => Promise<EcommerceImageGenerationResult[]>;
  enqueueTask?: (job: () => Promise<void>) => void;
}
