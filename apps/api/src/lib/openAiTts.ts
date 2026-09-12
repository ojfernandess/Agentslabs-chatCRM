import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { putMessageMediaFile } from "./mediaStorage.js";
import { stripTextForSpeech } from "./elevenLabsTts.js";

function openAiKeyForTts(): string | null {
  const k = config.openAiPromptPreviewKey?.trim();
  return k.length > 0 ? k : null;
}

/** Síntese de voz via OpenAI (fallback quando ElevenLabs não está configurado). */
export async function synthesizeOpenAiSpeech(options: {
  text: string;
  log: FastifyBaseLogger;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const apiKey = openAiKeyForTts();
  if (!apiKey) return null;

  const speechText = stripTextForSpeech(options.text).slice(0, 4096);
  if (!speechText) return null;

  const model = (process.env.OPENAI_TTS_MODEL?.trim() || "tts-1").slice(0, 64);
  const voice = (process.env.OPENAI_TTS_VOICE?.trim() || "nova").slice(0, 32);
  const base = config.openAiApiBaseUrl.replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: speechText,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errBody = (await res.text().catch(() => "")).slice(0, 500);
      options.log.warn({ status: res.status, errBody }, "OpenAI TTS request failed");
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    const token = randomBytes(16).toString("hex");
    const filename = `${token}.mp3`;
    const stored = await putMessageMediaFile({
      filename,
      buffer: buf,
      contentType: "audio/mpeg",
    });
    return { mediaUrl: stored.mediaUrl, mediaType: "audio/mpeg" };
  } catch (err) {
    options.log.warn({ err }, "OpenAI TTS synthesis failed");
    return null;
  }
}
