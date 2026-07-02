import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply } from "fastify";
import { randomBytes } from "node:crypto";
import { putMessageMediaFile } from "./mediaStorage.js";

export function allowProfileImageUpload(mime: string): boolean {
  const m = mime.split(";")[0].trim().toLowerCase();
  return (
    m === "image/png" ||
    m === "image/jpeg" ||
    m === "image/jpg" ||
    m === "image/webp" ||
    m === "image/gif"
  );
}

function extensionForMime(mime: string, originalFilename?: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  if (map[m]) return map[m];
  const ext = originalFilename?.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 8) return ext;
  return "jpg";
}

export async function persistUserAvatarUpload(
  file: MultipartFile,
  reply: FastifyReply,
): Promise<string | null> {
  const rawMime = file.mimetype ?? "";
  if (!allowProfileImageUpload(rawMime)) {
    await reply.status(415).send({
      error: "Unsupported Media Type",
      message: "Allowed: PNG, JPEG, WebP or GIF",
      statusCode: 415,
    });
    return null;
  }
  const mime = rawMime.split(";")[0].trim().toLowerCase();
  const buf = await file.toBuffer();
  if (buf.length > 2 * 1024 * 1024) {
    await reply.status(413).send({
      error: "Payload Too Large",
      message: "Avatar must be 2 MB or smaller",
      statusCode: 413,
    });
    return null;
  }
  const ext = extensionForMime(rawMime, file.filename ?? undefined);
  const filename = `${randomBytes(16).toString("hex")}.${ext}`;
  const stored = await putMessageMediaFile({
    filename,
    buffer: buf,
    contentType: mime || "application/octet-stream",
  });
  return stored.mediaUrl;
}
