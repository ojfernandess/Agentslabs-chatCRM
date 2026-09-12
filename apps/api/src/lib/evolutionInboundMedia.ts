import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { evolutionApiResolveInstanceName } from "./evolutionInstanceApi.js";
import {
  getEvolutionPlatformConfig,
  isEvolutionQrModeActive,
  resolveEvolutionApiCredentials,
  resolveEvolutionQrFlowContext,
  resolveEvolutionQrPlatformCredentials,
} from "./evolutionPlatform.js";
import { putMessageMediaFile } from "./mediaStorage.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function unwrapInnerMessage(m: Record<string, unknown>): Record<string, unknown> {
  const ephemeral = asRecord(m.ephemeralMessage);
  if (ephemeral) {
    const inner = asRecord(ephemeral.message);
    if (inner) return inner;
  }
  for (const wrap of ["viewOnceMessage", "viewOnceMessageV2"] as const) {
    const w = asRecord(m[wrap]);
    if (w) {
      const inner = asRecord(w.message);
      if (inner) return inner;
    }
  }
  const docCap = asRecord(m.documentWithCaptionMessage);
  if (docCap) {
    const inner = asRecord(docCap.message);
    if (inner) return inner;
  }
  return m;
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

function extractInlineMediaFromEvolutionMessage(
  rec: Record<string, unknown>,
): { base64: string; mimetype: string; fileName?: string } | null {
  const topLevel =
    typeof rec.base64 === "string" && rec.base64.trim()
      ? {
          base64: rec.base64.trim(),
          mimetype:
            typeof rec.mimetype === "string"
              ? rec.mimetype
              : typeof rec.mimeType === "string"
                ? rec.mimeType
                : "application/octet-stream",
          fileName: typeof rec.fileName === "string" ? rec.fileName : undefined,
        }
      : null;
  if (topLevel) {
    return { ...topLevel, base64: normalizeBase64String(topLevel.base64) };
  }

  const message = unwrapInnerMessage(asRecord(rec.message) ?? {});
  for (const key of ["audioMessage", "imageMessage", "videoMessage", "documentMessage"] as const) {
    const media = asRecord(message[key]);
    if (!media) continue;
    const raw =
      typeof media.base64 === "string" && media.base64.trim()
        ? media.base64.trim()
        : null;
    if (!raw) continue;
    return {
      base64: normalizeBase64String(raw),
      mimetype:
        typeof media.mimetype === "string"
          ? media.mimetype
          : typeof media.mimeType === "string"
            ? media.mimeType
            : "application/octet-stream",
      fileName: typeof media.fileName === "string" ? media.fileName : undefined,
    };
  }
  return null;
}

async function persistBase64Media(options: {
  base64: string;
  mimetype: string;
  fileName?: string;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  let buf: Buffer;
  try {
    buf = Buffer.from(options.base64, "base64");
  } catch {
    return null;
  }
  if (buf.length < 8) return null;

  const ext = extensionForMimetype(options.mimetype, options.fileName);
  const token = randomBytes(16).toString("hex");
  const filename = `${token}.${ext}`;
  const mime = options.mimetype.split(";")[0].trim().toLowerCase();
  const stored = await putMessageMediaFile({
    filename,
    buffer: buf,
    contentType: mime || "application/octet-stream",
  });
  return {
    mediaUrl: stored.mediaUrl,
    mediaType: mime || "application/octet-stream",
  };
}

async function resolveEvolutionMediaCredentials(
  organizationId: string,
): Promise<{ baseUrl: string; apiKey: string; instanceName: string } | null> {
  const platform = await getEvolutionPlatformConfig();
  if (isEvolutionQrModeActive(platform)) {
    const ctx = await resolveEvolutionQrFlowContext(organizationId);
    if (!ctx) return null;
    const creds = await resolveEvolutionQrPlatformCredentials(ctx.instanceName);
    if (!creds) return null;
    const resolved = await evolutionApiResolveInstanceName(
      creds.baseUrl,
      creds.apiKey,
      creds.instanceName,
      organizationId,
    );
    return {
      ...creds,
      instanceName: resolved.name || creds.instanceName,
    };
  }

  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (settings?.whatsappProvider !== "evolution") return null;
  return resolveEvolutionApiCredentials(settings);
}

async function fetchBase64FromEvolutionApi(
  creds: { baseUrl: string; apiKey: string; instanceName: string },
  evolutionWebMessage: Record<string, unknown>,
): Promise<{ base64: string; mimetype: string; fileName?: string } | null> {
  const enc = encodeURIComponent(creds.instanceName);
  const url = `${creds.baseUrl.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${enc}`;

  const key = asRecord(evolutionWebMessage.key);
  const innerMessage = asRecord(evolutionWebMessage.message);
  const bodies: Array<Record<string, unknown>> = [
    { message: evolutionWebMessage, convertToMp4: false },
    { message: evolutionWebMessage, convertToMp4: true },
  ];
  if (key && innerMessage) {
    bodies.push({ message: { key, message: innerMessage }, convertToMp4: false });
    bodies.push({ message: { key, message: innerMessage }, convertToMp4: true });
  }

  for (const body of bodies) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) continue;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      continue;
    }
    const extracted = extractBase64Payload(json);
    if (extracted) return extracted;
  }
  return null;
}

/**
 * Evolution: grava media inbound no disco com URL pública (evita CORS / URL .enc no browser).
 */
export async function persistEvolutionInboundMediaAsLocalUrl(options: {
  organizationId: string;
  evolutionWebMessage: Record<string, unknown>;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const inline = extractInlineMediaFromEvolutionMessage(options.evolutionWebMessage);
  if (inline) {
    return persistBase64Media(inline);
  }

  const creds = await resolveEvolutionMediaCredentials(options.organizationId);
  if (!creds) return null;

  const extracted = await fetchBase64FromEvolutionApi(creds, options.evolutionWebMessage);
  if (!extracted) return null;

  return persistBase64Media(extracted);
}
