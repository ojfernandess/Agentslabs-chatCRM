import type { MessageType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { persistTelegramInboundMediaAsLocalUrl } from "./telegramInboundMedia.js";

export type TelegramInboundPayload = {
  participantId: string;
  participantName?: string;
  body: string | null;
  type: MessageType;
  mediaUrl: string | null;
  mediaType: string | null;
  externalMessageId: string | null;
};

type TelegramFileRef = {
  fileId: string;
  mimeType: string;
  fileName?: string;
};

function messageText(msg: Record<string, unknown>): string | null {
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.caption === "string") return msg.caption;
  return null;
}

function extractTelegramFile(msg: Record<string, unknown>): { type: MessageType; file: TelegramFileRef } | null {
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const last = msg.photo[msg.photo.length - 1] as { file_id?: string };
    if (last.file_id) {
      return { type: "IMAGE", file: { fileId: last.file_id, mimeType: "image/jpeg" } };
    }
  }
  if (msg.voice && typeof msg.voice === "object") {
    const v = msg.voice as { file_id?: string; mime_type?: string };
    if (v.file_id) {
      return { type: "AUDIO", file: { fileId: v.file_id, mimeType: v.mime_type ?? "audio/ogg" } };
    }
  }
  if (msg.audio && typeof msg.audio === "object") {
    const a = msg.audio as { file_id?: string; mime_type?: string; file_name?: string };
    if (a.file_id) {
      return {
        type: "AUDIO",
        file: {
          fileId: a.file_id,
          mimeType: a.mime_type ?? "audio/mpeg",
          fileName: a.file_name,
        },
      };
    }
  }
  if (msg.video && typeof msg.video === "object") {
    const v = msg.video as { file_id?: string; mime_type?: string; file_name?: string };
    if (v.file_id) {
      return {
        type: "VIDEO",
        file: {
          fileId: v.file_id,
          mimeType: v.mime_type ?? "video/mp4",
          fileName: v.file_name,
        },
      };
    }
  }
  if (msg.video_note && typeof msg.video_note === "object") {
    const v = msg.video_note as { file_id?: string; mime_type?: string };
    if (v.file_id) {
      return { type: "VIDEO", file: { fileId: v.file_id, mimeType: v.mime_type ?? "video/mp4" } };
    }
  }
  if (msg.document && typeof msg.document === "object") {
    const doc = msg.document as { file_id?: string; mime_type?: string; file_name?: string };
    if (doc.file_id) {
      return {
        type: "DOCUMENT",
        file: {
          fileId: doc.file_id,
          mimeType: doc.mime_type ?? "application/octet-stream",
          fileName: doc.file_name,
        },
      };
    }
  }
  return null;
}

async function resolveTelegramMedia(
  file: TelegramFileRef,
  botToken: string | null,
  log: FastifyBaseLogger,
): Promise<{ mediaUrl: string | null; mediaType: string | null }> {
  if (!botToken) {
    log.warn({ fileId: file.fileId }, "telegram inbound media: bot token missing");
    return { mediaUrl: null, mediaType: file.mimeType };
  }

  const tryPersist = () =>
    persistTelegramInboundMediaAsLocalUrl({
      botToken,
      fileId: file.fileId,
      mimeTypeHint: file.mimeType,
      fileName: file.fileName,
      log,
    });

  let local = await tryPersist();
  if (!local) {
    await new Promise((r) => setTimeout(r, 800));
    local = await tryPersist();
  }
  if (!local) {
    log.warn({ fileId: file.fileId }, "telegram inbound media: download failed");
    return { mediaUrl: null, mediaType: file.mimeType };
  }
  return { mediaUrl: local.mediaUrl, mediaType: local.mediaType };
}

export type TelegramInboundBuildResult =
  | { status: "ok"; payload: TelegramInboundPayload }
  | { status: "ignored" }
  | { status: "error"; message: string };

/** Converte update JSON do Bot API num payload pronto para ingest. */
export async function buildTelegramInboundPayload(
  raw: unknown,
  options: { botToken: string | null; log: FastifyBaseLogger },
): Promise<TelegramInboundBuildResult> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "ignored" };
  }

  const msg =
    (raw as { message?: Record<string, unknown>; edited_message?: Record<string, unknown> }).message ??
    (raw as { edited_message?: Record<string, unknown> }).edited_message;
  if (!msg || typeof msg !== "object") return { status: "ignored" };

  const chat = msg.chat as { id?: unknown } | undefined;
  const from = msg.from as { id?: unknown; first_name?: string; username?: string } | undefined;
  const chatId = chat?.id;
  const participantId = chatId != null ? String(chatId) : from?.id != null ? String(from.id) : null;
  if (!participantId) {
    return { status: "error", message: "Missing chat/user id" };
  }

  const participantName =
    [from?.first_name, from && "username" in from ? (from as { username?: string }).username : undefined]
      .filter(Boolean)
      .join(" ")
      .trim() || undefined;

  const body = messageText(msg);
  const media = extractTelegramFile(msg);
  let type: MessageType = "TEXT";
  let mediaUrl: string | null = null;
  let mediaType: string | null = null;

  if (media) {
    type = media.type;
    const resolved = await resolveTelegramMedia(media.file, options.botToken, options.log);
    mediaUrl = resolved.mediaUrl;
    mediaType = resolved.mediaType;
  }

  const externalMessageId =
    typeof msg.message_id === "number" || typeof msg.message_id === "string" ? String(msg.message_id) : null;

  return {
    status: "ok",
    payload: {
      participantId,
      participantName,
      body,
      type,
      mediaUrl,
      mediaType,
      externalMessageId,
    },
  };
}
