import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../db.js";
import { config, getPublicOrigin } from "../config.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

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

function extractBase64Payload(
  json: unknown,
): { base64: string; mimetype: string; fileName?: string } | null {
  const tryObj = (o: Record<string, unknown> | null) => {
    if (!o) return null;
    const raw = o.base64;
    if (typeof raw !== "string" || !raw.length) return null;
    const mimetype =
      typeof o.mimetype === "string"
        ? o.mimetype
        : typeof o.mimeType === "string"
          ? o.mimeType
          : "application/octet-stream";
    const fileName = typeof o.fileName === "string" ? o.fileName : undefined;
    return { base64: normalizeBase64String(raw), mimetype, fileName };
  };

  const top = tryObj(asRecord(json));
  if (top) return top;
  const data = asRecord((json as Record<string, unknown>)?.data);
  return tryObj(data);
}

/**
 * Evolution: grava media inbound no disco com URL pública (evita CORS / URL .enc no browser).
 */
export async function persistEvolutionInboundMediaAsLocalUrl(options: {
  organizationId: string;
  evolutionWebMessage: Record<string, unknown>;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId: options.organizationId },
  });
  if (settings?.whatsappProvider !== "evolution") return null;
  const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
  const instance = settings.whatsappPhoneNumberId?.trim() ?? "";
  const apiKey = settings.whatsappApiKey;
  if (!baseUrl || !instance || !apiKey) return null;

  const enc = encodeURIComponent(instance);
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${enc}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: options.evolutionWebMessage,
      convertToMp4: false,
    }),
  });

  if (!response.ok) {
    return null;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return null;
  }

  const extracted = extractBase64Payload(json);
  if (!extracted) return null;

  let buf: Buffer;
  try {
    buf = Buffer.from(extracted.base64, "base64");
  } catch {
    return null;
  }
  if (buf.length < 8) return null;

  const ext = extensionForMimetype(extracted.mimetype, extracted.fileName);
  const token = randomBytes(16).toString("hex");
  const filename = `${token}.${ext}`;
  const dir = config.mediaUploadDir;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), buf);

  const mime = extracted.mimetype.split(";")[0].trim().toLowerCase();
  return {
    mediaUrl: `${getPublicOrigin()}/api/v1/messages/media/${filename}`,
    mediaType: mime || "application/octet-stream",
  };
}
