import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { putMessageMediaFile } from "./mediaStorage.js";

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

/** Telegram Bot API: descarrega ficheiro pelo file_id e grava URL pública local. */
export async function persistTelegramInboundMediaAsLocalUrl(options: {
  botToken: string;
  fileId: string;
  mimeTypeHint?: string;
  fileName?: string;
  log?: FastifyBaseLogger;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const fileId = options.fileId.trim();
  const token = options.botToken.trim();
  if (!fileId || !token) return null;

  try {
    const getFileRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(30_000),
    });
    const getFileJson = (await getFileRes.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { file_path?: string };
      description?: string;
    };
    if (!getFileRes.ok || !getFileJson.ok || !getFileJson.result?.file_path) {
      options.log?.warn(
        { fileId, status: getFileRes.status, description: getFileJson.description },
        "telegram getFile failed",
      );
      return null;
    }

    const filePath = getFileJson.result.file_path.trim();
    const downloadUrl = `https://api.telegram.org/file/bot${encodeURIComponent(token)}/${filePath}`;
    const fileRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!fileRes.ok) {
      options.log?.warn({ fileId, status: fileRes.status }, "telegram file download failed");
      return null;
    }

    const buf = Buffer.from(await fileRes.arrayBuffer());
    if (buf.length < 8) return null;

    const mime =
      (options.mimeTypeHint ??
        fileRes.headers.get("content-type") ??
        "application/octet-stream").split(";")[0].trim().toLowerCase();
    const ext = extensionForMimetype(mime, options.fileName ?? filePath.split("/").pop());
    const filename = `${randomBytes(16).toString("hex")}.${ext}`;
    const stored = await putMessageMediaFile({
      filename,
      buffer: buf,
      contentType: mime,
    });
    return { mediaUrl: stored.mediaUrl, mediaType: mime };
  } catch (err) {
    options.log?.warn({ err, fileId }, "telegram inbound media persist error");
    return null;
  }
}
