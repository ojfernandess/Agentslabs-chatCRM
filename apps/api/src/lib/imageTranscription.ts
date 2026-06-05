import type { FastifyBaseLogger } from "fastify";
import type { Message } from "@prisma/client";
import { config, getPublicOrigin } from "../config.js";
import { prisma } from "../db.js";
import { readMessageMediaFile } from "./mediaStorage.js";

const LOCAL_MEDIA_FILENAME_RE = /^[a-f0-9]{32}\.[a-z0-9]+$/i;
const LOCAL_MEDIA_PATH = "/api/v1/messages/media/";

export const IMAGE_TRANSCRIPTION_PREFIX = "[Transcrição de imagem]";

export type ImageTranscriptionPayload = {
  description: string;
  extractedText: string;
};

function openAiKeyForVision(): string | null {
  const k = config.openAiPromptPreviewKey?.trim();
  return k.length > 0 ? k : null;
}

function mimeFromFilename(name: string, hint: string | null | undefined): string {
  const mt = (hint ?? "").split(";")[0].trim().toLowerCase();
  if (mt.startsWith("image/")) return mt;
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  return (ext && map[ext]) || "image/jpeg";
}

async function loadImageBytesForTranscription(
  mediaUrl: string,
  mediaType: string | null | undefined,
): Promise<{ buffer: Buffer; mime: string } | null> {
  const trimmed = mediaUrl.trim();
  if (!trimmed) return null;

  try {
    const u = new URL(trimmed, getPublicOrigin());
    const idx = u.pathname.indexOf(LOCAL_MEDIA_PATH);
    if (idx !== -1) {
      const name = u.pathname.slice(idx + LOCAL_MEDIA_PATH.length);
      if (LOCAL_MEDIA_FILENAME_RE.test(name)) {
        const buffer = await readMessageMediaFile(name);
        if (buffer && buffer.length >= 32) {
          return { buffer, mime: mimeFromFilename(name, mediaType) };
        }
      }
    }

    if (u.protocol === "https:" || u.protocol === "http:") {
      const res = await fetch(trimmed, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      if (buffer.length < 32) return null;
      const mime = mimeFromFilename(trimmed, res.headers.get("content-type") ?? mediaType);
      return { buffer, mime };
    }
  } catch {
    return null;
  }
  return null;
}

async function transcribeImageWithOpenAi(input: {
  buffer: Buffer;
  mime: string;
  log: FastifyBaseLogger;
}): Promise<ImageTranscriptionPayload | null> {
  const apiKey = openAiKeyForVision();
  if (!apiKey) return null;

  const model = config.openAiVisionModel || "gpt-4o-mini";
  const endpoint = `${config.openAiApiBaseUrl}/chat/completions`;
  const dataUrl = `data:${input.mime};base64,${input.buffer.toString("base64")}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Analise a imagem. Responda em JSON com os campos: " +
                  '"description" (descrição da imagem em português, 1-3 frases) e ' +
                  '"extractedText" (todo texto visível na imagem, preserve quebras de linha; string vazia se não houver texto).',
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      input.log.warn({ status: res.status, snippet: raw.slice(0, 300), model }, "OpenAI image transcription failed");
      return null;
    }
    let parsed: { choices?: { message?: { content?: string } }[] };
    try {
      parsed = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
    } catch {
      return null;
    }
    const content = parsed.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    let payload: ImageTranscriptionPayload;
    try {
      payload = JSON.parse(content) as ImageTranscriptionPayload;
    } catch {
      return null;
    }
    const description = String(payload.description ?? "").trim();
    const extractedText = String(payload.extractedText ?? "").trim();
    if (!description && !extractedText) return null;
    return { description, extractedText };
  } catch (err) {
    input.log.warn({ err, model }, "OpenAI image transcription request error");
    return null;
  }
}

export function formatImageTranscriptionBody(payload: ImageTranscriptionPayload): string {
  return `${IMAGE_TRANSCRIPTION_PREFIX}${JSON.stringify(payload)}`.slice(0, 16_000);
}

/**
 * Se a organização activou transcrição de imagem e a mensagem for IMAGE sem texto,
 * analisa (OpenAI Vision) e grava o corpo estruturado em `message.body`.
 */
export async function maybeTranscribeInboundImageMessage(input: {
  message: Message;
  enabled: boolean;
  log: FastifyBaseLogger;
}): Promise<Message> {
  const { message, enabled, log } = input;
  if (!enabled || message.type !== "IMAGE") return message;
  if (message.body?.trim()) return message;
  const mediaUrl = message.mediaUrl?.trim();
  if (!mediaUrl) return message;
  if (!openAiKeyForVision()) {
    log.warn({}, "Image transcription skipped: no OPENAI_PROMPT_PREVIEW_KEY / OPENAI_API_KEY on server");
    return message;
  }

  const loaded = await loadImageBytesForTranscription(mediaUrl, message.mediaType);
  if (!loaded) {
    log.warn({ messageId: message.id }, "Image transcription skipped: could not load media bytes");
    return message;
  }

  const payload = await transcribeImageWithOpenAi({ buffer: loaded.buffer, mime: loaded.mime, log });
  if (!payload) return message;

  const body = formatImageTranscriptionBody(payload);
  return prisma.message.update({
    where: { id: message.id },
    data: { body },
  });
}
