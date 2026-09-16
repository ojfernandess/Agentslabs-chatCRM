import { randomBytes } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import type { MessageType } from "@prisma/client";
import { putMessageMediaFile } from "./mediaStorage.js";

export function extensionForUploadMimetype(mimetype: string, originalFilename?: string): string {
  const m = mimetype.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "video/webm": "webm",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };
  if (map[m]) return map[m];
  const ext = originalFilename?.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 8) return ext;
  return "bin";
}

export function normalizeMultipartMime(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase();
}

export function allowAudioVoiceUpload(mime: string): boolean {
  const m = normalizeMultipartMime(mime);
  return m.startsWith("audio/") || m === "video/webm";
}

export function allowRichMediaUpload(mime: string): boolean {
  const m = normalizeMultipartMime(mime);
  if (m.startsWith("image/")) return true;
  if (m.startsWith("audio/")) return true;
  if (m.startsWith("video/")) return true;
  if (m === "video/webm") return true;
  if (m === "application/pdf") return true;
  if (m === "application/msword") return true;
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  return false;
}

export async function persistMultipartMedia(
  file: MultipartFile,
  allow: (mime: string) => boolean,
  rejectDetail: string,
  reply: FastifyReply,
): Promise<{ mediaUrl: string; mimeType: string } | null> {
  const rawMime = file.mimetype ?? "";
  if (!allow(rawMime)) {
    await reply.status(415).send({
      error: "Unsupported Media Type",
      message: rejectDetail,
      statusCode: 415,
    });
    return null;
  }

  const mime = normalizeMultipartMime(rawMime);
  const buf = await file.toBuffer();
  const ext = extensionForUploadMimetype(rawMime, file.filename ?? undefined);
  const token = randomBytes(16).toString("hex");
  const filename = `${token}.${ext}`;
  const stored = await putMessageMediaFile({
    filename,
    buffer: buf,
    contentType: mime || "application/octet-stream",
  });
  return { mediaUrl: stored.mediaUrl, mimeType: mime || "application/octet-stream" };
}

export function messageTypeFromMime(mime: string): MessageType {
  const m = normalizeMultipartMime(mime);
  if (m.startsWith("image/")) return "IMAGE";
  if (m.startsWith("audio/")) return "AUDIO";
  if (m.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}
