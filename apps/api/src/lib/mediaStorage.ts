import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config, getPublicOrigin } from "../config.js";
import {
  getMediaStoragePlatformValueFromDb,
  type MediaStorageDriver,
  type MediaStoragePlatformValue,
} from "./mediaStorageSettings.js";

export type ResolvedMediaStorage = {
  driver: MediaStorageDriver;
  localDir: string;
  minio?: {
    client: S3Client;
    bucket: string;
    publicBaseUrl?: string;
  };
};

let resolvedCache: { at: number; value: ResolvedMediaStorage } | null = null;
const CACHE_MS = 15_000;

function envDriver(): MediaStorageDriver {
  const d = config.mediaStorageDriver.trim().toLowerCase();
  return d === "minio" ? "minio" : "local";
}

function buildMinioClient(opts: {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
  useSsl: boolean;
}): S3Client {
  const endpoint = opts.endpoint.replace(/\/+$/, "");
  return new S3Client({
    endpoint,
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKey,
      secretAccessKey: opts.secretKey,
    },
    forcePathStyle: true,
    tls: opts.useSsl,
  });
}

async function resolveFromPlatform(): Promise<ResolvedMediaStorage | null> {
  const platform = await getMediaStoragePlatformValueFromDb();
  if (!platform?.enabled) return null;

  if (platform.driver === "local") {
    return { driver: "local", localDir: config.mediaUploadDir };
  }

  const client = buildMinioClient({
    endpoint: platform.endpoint!,
    accessKey: platform.accessKey!,
    secretKey: platform.secretKey!,
    region: platform.region ?? "us-east-1",
    useSsl: platform.useSsl === true,
  });

  return {
    driver: "minio",
    localDir: config.mediaUploadDir,
    minio: {
      client,
      bucket: platform.bucket!,
      publicBaseUrl: platform.publicBaseUrl,
    },
  };
}

function resolveFromEnv(): ResolvedMediaStorage | null {
  if (envDriver() !== "minio") return null;
  const endpoint = config.minioEndpoint.trim();
  const accessKey = config.minioAccessKey.trim();
  const secretKey = config.minioSecretKey.trim();
  const bucket = config.minioBucket.trim();
  if (!endpoint || !accessKey || !secretKey || !bucket) return null;

  const client = buildMinioClient({
    endpoint,
    accessKey,
    secretKey,
    region: config.minioRegion,
    useSsl: config.minioUseSsl,
  });

  const publicBase = config.minioPublicBaseUrl.trim().replace(/\/+$/, "") || undefined;
  return {
    driver: "minio",
    localDir: config.mediaUploadDir,
    minio: { client, bucket, publicBaseUrl: publicBase },
  };
}

/** Ordem: super admin (platform_settings) → env MINIO → disco local. */
export async function getResolvedMediaStorage(): Promise<ResolvedMediaStorage> {
  const now = Date.now();
  if (resolvedCache && now - resolvedCache.at < CACHE_MS) {
    return resolvedCache.value;
  }

  const fromPlatform = await resolveFromPlatform();
  const value = fromPlatform ?? resolveFromEnv() ?? { driver: "local", localDir: config.mediaUploadDir };
  resolvedCache = { at: now, value };
  return value;
}

export function invalidateMediaStorageCache(): void {
  resolvedCache = null;
}

export function publicMessageMediaUrl(filename: string, storage?: ResolvedMediaStorage): string {
  const direct = storage?.minio?.publicBaseUrl;
  if (direct) {
    return `${direct}/${encodeURIComponent(filename)}`;
  }
  return `${getPublicOrigin()}/api/v1/messages/media/${filename}`;
}

export async function putMessageMediaFile(options: {
  filename: string;
  buffer: Buffer;
  contentType: string;
}): Promise<{ mediaUrl: string }> {
  const storage = await getResolvedMediaStorage();
  const contentType = options.contentType.split(";")[0].trim() || "application/octet-stream";

  if (storage.driver === "minio" && storage.minio) {
    await storage.minio.client.send(
      new PutObjectCommand({
        Bucket: storage.minio.bucket,
        Key: options.filename,
        Body: options.buffer,
        ContentType: contentType,
      }),
    );
    return { mediaUrl: publicMessageMediaUrl(options.filename, storage) };
  }

  const dir = storage.localDir;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, options.filename), options.buffer);
  return { mediaUrl: publicMessageMediaUrl(options.filename, storage) };
}

export async function readMessageMediaFile(filename: string): Promise<Buffer | null> {
  const storage = await getResolvedMediaStorage();

  if (storage.driver === "minio" && storage.minio) {
    try {
      const out = await storage.minio.client.send(
        new GetObjectCommand({
          Bucket: storage.minio.bucket,
          Key: filename,
        }),
      );
      const body = out.Body;
      if (!body) return null;
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  }

  const filePath = join(storage.localDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

export async function openMessageMediaReadStream(
  filename: string,
): Promise<{ stream: Readable; contentType: string } | null> {
  const storage = await getResolvedMediaStorage();

  if (storage.driver === "minio" && storage.minio) {
    try {
      const out = await storage.minio.client.send(
        new GetObjectCommand({
          Bucket: storage.minio.bucket,
          Key: filename,
        }),
      );
      const body = out.Body;
      if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") return null;
      const contentType =
        typeof out.ContentType === "string" && out.ContentType.trim()
          ? out.ContentType.split(";")[0].trim()
          : "application/octet-stream";
      return { stream: body as Readable, contentType };
    } catch {
      return null;
    }
  }

  const filePath = join(storage.localDir, filename);
  if (!existsSync(filePath)) return null;
  return { stream: createReadStream(filePath), contentType: "application/octet-stream" };
}
