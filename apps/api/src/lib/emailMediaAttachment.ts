import { getPublicOrigin } from "../config.js";
import { readMessageMediaFile } from "./mediaStorage.js";

const LOCAL_MEDIA_PATH = "/api/v1/messages/media/";
const LOCAL_MEDIA_FILENAME_RE = /^[a-f0-9]{32}\.[a-z0-9]+$/i;

export type EmailSmtpAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export function mediaStorageFilenameFromUrl(mediaUrl: string): string | null {
  const trimmed = mediaUrl.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed, getPublicOrigin());
    const idx = u.pathname.indexOf(LOCAL_MEDIA_PATH);
    if (idx !== -1) {
      const name = decodeURIComponent(u.pathname.slice(idx + LOCAL_MEDIA_PATH.length));
      if (LOCAL_MEDIA_FILENAME_RE.test(name)) return name;
    }
    const tail = u.pathname.split("/").pop();
    if (tail && LOCAL_MEDIA_FILENAME_RE.test(decodeURIComponent(tail))) {
      return decodeURIComponent(tail);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pickAttachmentFilename(storageName: string, hint?: string | null): string {
  const fromHint = hint?.trim().split(/[/\\]/).pop()?.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120);
  if (fromHint && fromHint.includes(".")) return fromHint;
  return storageName;
}

function normalizeContentType(raw: string | null | undefined, filename: string): string {
  const mt = raw?.split(";")[0].trim().toLowerCase();
  if (mt && mt !== "application/octet-stream") return mt;
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

/** Carrega ficheiro de mediaUrl (storage local/MinIO) para anexo SMTP. */
export async function loadEmailOutboundAttachment(options: {
  mediaUrl: string;
  mediaType?: string | null;
  filenameHint?: string | null;
}): Promise<EmailSmtpAttachment | null> {
  const storageName = mediaStorageFilenameFromUrl(options.mediaUrl);
  if (!storageName) return null;
  const buffer = await readMessageMediaFile(storageName);
  if (!buffer || buffer.length < 1) return null;
  const filename = pickAttachmentFilename(storageName, options.filenameHint ?? storageName);
  return {
    filename,
    content: buffer,
    contentType: normalizeContentType(options.mediaType, filename),
  };
}
