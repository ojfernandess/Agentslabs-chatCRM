import { prisma } from "../db.js";

/** Chave em `platform_settings` — activável no super admin. */
export const MEDIA_STORAGE_PLATFORM_KEY = "media_storage";

export type MediaStorageDriver = "local" | "minio";

export type MediaStoragePlatformValue = {
  enabled: boolean;
  driver: MediaStorageDriver;
  endpoint?: string;
  bucket?: string;
  accessKey?: string;
  secretKey?: string;
  useSsl?: boolean;
  region?: string;
  /** URL pública opcional (CDN / bucket público). Vazio = proxy API `/api/v1/messages/media/`. */
  publicBaseUrl?: string;
};

export function parseMediaStoragePlatformValue(raw: unknown): MediaStoragePlatformValue | null {
  if (!raw || typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true;
  const driverRaw = String(o.driver ?? "local").trim().toLowerCase();
  const driver: MediaStorageDriver = driverRaw === "minio" ? "minio" : "local";
  if (!enabled) return { enabled: false, driver: "local" };
  if (driver === "local") {
    return { enabled: true, driver: "local" };
  }
  const endpoint = String(o.endpoint ?? "").trim();
  const bucket = String(o.bucket ?? "").trim();
  const accessKey = String(o.accessKey ?? "").trim();
  const secretKey = String(o.secretKey ?? "").trim();
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return {
    enabled: true,
    driver: "minio",
    endpoint,
    bucket,
    accessKey,
    secretKey,
    useSsl: o.useSsl === true,
    region: String(o.region ?? "us-east-1").trim() || "us-east-1",
    publicBaseUrl: String(o.publicBaseUrl ?? "").trim().replace(/\/+$/, "") || undefined,
  };
}

export async function getMediaStoragePlatformValueFromDb(): Promise<MediaStoragePlatformValue | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: MEDIA_STORAGE_PLATFORM_KEY },
  });
  return parseMediaStoragePlatformValue(row?.value);
}
