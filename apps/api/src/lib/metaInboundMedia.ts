import { randomBytes } from "node:crypto";
import { putMessageMediaFile } from "./mediaStorage.js";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function extensionForMimetype(mimetype: string, fileName?: string): string {
  const m = mimetype.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "audio/aac": "aac",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  if (map[m]) return map[m];
  const ext = fileName?.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 8) return ext;
  return "bin";
}

/**
 * Meta Cloud API: descarrega media pelo ID Graph e grava URL pública local (como Evolution inbound).
 */
export async function persistMetaInboundMediaAsLocalUrl(options: {
  accessToken: string;
  mediaId: string;
  mimeTypeHint?: string;
  fileName?: string;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const mediaId = options.mediaId.trim();
  const token = options.accessToken.trim();
  if (!mediaId || !token) return null;

  const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) return null;

  const metaJson = (await metaRes.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
    error?: { message?: string };
  };
  const downloadUrl = metaJson.url?.trim();
  if (!downloadUrl) return null;

  const fileRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) return null;

  const buf = Buffer.from(await fileRes.arrayBuffer());
  if (buf.length < 8) return null;

  const mime =
    (metaJson.mime_type ?? options.mimeTypeHint ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  const ext = extensionForMimetype(mime, options.fileName);
  const filename = `${randomBytes(16).toString("hex")}.${ext}`;
  const stored = await putMessageMediaFile({
    filename,
    buffer: buf,
    contentType: mime,
  });
  return { mediaUrl: stored.mediaUrl, mediaType: mime };
}
