import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, getPublicOrigin } from "../config.js";

function normalizeBase64String(s: string): string {
  const m = /^data:[^;]+;base64,(.+)$/i.exec(s.trim());
  return m ? m[1]! : s.trim();
}

function extensionForMimetype(mimetype: string, fileName?: string): string {
  const m = mimetype.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "audio/aac": "aac",
    "video/mp4": "mp4",
  };
  if (map[m]) return map[m];
  const ext = fileName?.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 8) return ext;
  return "bin";
}

export async function persistEvolutionGoInboundMediaAsLocalUrl(options: {
  base64: string;
  mimetype: string;
  fileName?: string;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const raw = normalizeBase64String(options.base64);
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (buf.length < 8) return null;

  const ext = extensionForMimetype(options.mimetype, options.fileName);
  const token = randomBytes(16).toString("hex");
  const filename = `${token}.${ext}`;
  const dir = config.mediaUploadDir;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buf);

  const mime = options.mimetype.split(";")[0].trim().toLowerCase();
  return {
    mediaUrl: `${getPublicOrigin()}/api/v1/messages/media/${filename}`,
    mediaType: mime || "application/octet-stream",
  };
}

