import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage, PutObjectInput, StoredObject } from "./types.js";

const require = createRequire(import.meta.url);

export interface LocalObjectStorageOptions {
  rootDir: string;
  publicBaseUrl: string;
}

function assertSafeObjectKey(objectKey: string) {
  if (!objectKey || path.isAbsolute(objectKey) || objectKey.split(/[\\/]+/u).some((part) => part === "..")) {
    throw new Error("Unsafe object key.");
  }
}

function publicObjectUrl(publicBaseUrl: string, objectKey: string) {
  return `${publicBaseUrl.replace(/\/+$/u, "")}/${objectKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function getLocalEcommerceDataDir(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(env.ECOMMERCE_LOCAL_DATA_DIR ?? path.join(process.cwd(), ".local"));
}

export function getLocalObjectStorageRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.join(getLocalEcommerceDataDir(env), "ecommerce-cos");
}

export function createLocalObjectStorage(options: LocalObjectStorageOptions): ObjectStorage {
  return {
    async putObject(input: PutObjectInput): Promise<StoredObject> {
      assertSafeObjectKey(input.objectKey);
      const filePath = path.resolve(options.rootDir, ...input.objectKey.split("/"));
      const rootPath = path.resolve(options.rootDir);
      if (!filePath.startsWith(rootPath + path.sep) && filePath !== rootPath) {
        throw new Error("Object key escaped the storage root.");
      }

      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, input.body);
      return {
        objectKey: input.objectKey,
        cosUrl: publicObjectUrl(options.publicBaseUrl, input.objectKey)
      };
    }
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for Tencent COS storage.`);
  }
  return value;
}

export function createTencentCosObjectStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const SecretId = requireEnv(env, "TENCENT_COS_SECRET_ID");
  const SecretKey = requireEnv(env, "TENCENT_COS_SECRET_KEY");
  const Bucket = requireEnv(env, "TENCENT_COS_BUCKET");
  const Region = requireEnv(env, "TENCENT_COS_REGION");
  const publicBaseUrl = env.TENCENT_COS_PUBLIC_BASE_URL?.trim() || `https://${Bucket}.cos.${Region}.myqcloud.com`;
  const COS = require("cos-nodejs-sdk-v5");
  const cos = new COS({ SecretId, SecretKey });

  return {
    async putObject(input: PutObjectInput): Promise<StoredObject> {
      assertSafeObjectKey(input.objectKey);
      await new Promise<void>((resolve, reject) => {
        cos.putObject(
          {
            Bucket,
            Region,
            Key: input.objectKey,
            Body: input.body,
            ContentType: input.mimeType
          },
          (error: Error | null) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          }
        );
      });

      return {
        objectKey: input.objectKey,
        cosUrl: publicObjectUrl(publicBaseUrl, input.objectKey)
      };
    }
  };
}

export function createObjectStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  if (env.TENCENT_COS_BUCKET || env.TENCENT_COS_SECRET_ID || env.TENCENT_COS_SECRET_KEY || env.TENCENT_COS_REGION) {
    return createTencentCosObjectStorage(env);
  }

  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new Error("Tencent COS environment variables are required in production.");
  }

  return createLocalObjectStorage({
    rootDir: getLocalObjectStorageRoot(env),
    publicBaseUrl: "/local-cos"
  });
}
