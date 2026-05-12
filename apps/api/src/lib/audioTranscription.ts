import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { Message } from "@prisma/client";
import { config, getPublicOrigin } from "../config.js";
import { prisma } from "../db.js";

const LOCAL_MEDIA_FILENAME_RE = /^[a-f0-9]{32}\.[a-z0-9]+$/i;
const LOCAL_MEDIA_PATH = "/api/v1/messages/media/";

function openAiKeyForTranscription(): string | null {
  const k = config.openAiPromptPreviewKey?.trim();
  return k.length > 0 ? k : null;
}

function extensionFromMime(mediaType: string | null | undefined, fallbackName: string): string {
  const mt = (mediaType ?? "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  if (map[mt]) return map[mt];
  const fromName = fallbackName.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName) && fromName.length <= 8) return fromName;
  return "ogg";
}

async function loadAudioBytesForTranscription(
  mediaUrl: string,
  mediaType: string | null | undefined,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const trimmed = mediaUrl.trim();
  if (!trimmed) return null;

  try {
    const u = new URL(trimmed, getPublicOrigin());
    const idx = u.pathname.indexOf(LOCAL_MEDIA_PATH);
    if (idx !== -1) {
      const name = u.pathname.slice(idx + LOCAL_MEDIA_PATH.length);
      if (LOCAL_MEDIA_FILENAME_RE.test(name)) {
        const filePath = join(config.mediaUploadDir, name);
        if (existsSync(filePath)) {
          const buffer = await readFile(filePath);
          if (buffer.length < 16) return null;
          return { buffer, filename: name };
        }
      }
    }

    if (u.protocol === "https:" || u.protocol === "http:") {
      const res = await fetch(trimmed, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      if (buffer.length < 16) return null;
      const ext = extensionFromMime(res.headers.get("content-type") ?? mediaType, trimmed);
      return { buffer, filename: `inbound.${ext}` };
    }
  } catch {
    return null;
  }
  return null;
}

async function transcribeWithOpenAi(input: {
  buffer: Buffer;
  filename: string;
  log: FastifyBaseLogger;
}): Promise<string | null> {
  const apiKey = openAiKeyForTranscription();
  if (!apiKey) return null;

  const model = config.openAiWhisperModel || "whisper-1";
  const endpoint = `${config.openAiApiBaseUrl}/audio/transcriptions`;

  const blob = new Blob([new Uint8Array(input.buffer)]);
  const form = new FormData();
  form.append("file", blob, input.filename);
  form.append("model", model);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      input.log.warn(
        { status: res.status, snippet: raw.slice(0, 300), model },
        "OpenAI audio transcription failed",
      );
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as { text?: string };
    } catch {
      return null;
    }
    const text = typeof (parsed as { text?: string }).text === "string" ? (parsed as { text: string }).text : "";
    const t = text.trim();
    return t.length > 0 ? t : null;
  } catch (err) {
    input.log.warn({ err, model }, "OpenAI audio transcription request error");
    return null;
  }
}

const TRANSCRIPTION_PREFIX = "[Transcrição automática] ";

/** Prefixo gravado em `message.body` após transcrição (sem espaço final), para detecção no agente. */
export const AUDIO_TRANSCRIPTION_PREFIX = TRANSCRIPTION_PREFIX.trim();

/**
 * Se a organização activou transcrição e a mensagem for áudio sem texto,
 * transcreve (OpenAI) e grava o corpo em `message.body` antes do agente / regras.
 */
export async function maybeTranscribeInboundAudioMessage(input: {
  message: Message;
  enabled: boolean;
  log: FastifyBaseLogger;
}): Promise<Message> {
  const { message, enabled, log } = input;
  if (!enabled || message.type !== "AUDIO") return message;
  if (message.body?.trim()) return message;
  const mediaUrl = message.mediaUrl?.trim();
  if (!mediaUrl) return message;
  if (!openAiKeyForTranscription()) {
    log.warn({}, "Audio transcription skipped: no OPENAI_PROMPT_PREVIEW_KEY / OPENAI_API_KEY on server");
    return message;
  }

  const loaded = await loadAudioBytesForTranscription(mediaUrl, message.mediaType);
  if (!loaded) {
    log.warn({ messageId: message.id }, "Audio transcription skipped: could not load media bytes");
    return message;
  }

  const text = await transcribeWithOpenAi({
    buffer: loaded.buffer,
    filename: loaded.filename,
    log,
  });
  if (!text) return message;

  const body = `${TRANSCRIPTION_PREFIX}${text}`.slice(0, 16_000);
  return prisma.message.update({
    where: { id: message.id },
    data: { body },
  });
}
