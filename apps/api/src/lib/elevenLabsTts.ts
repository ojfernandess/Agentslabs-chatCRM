import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { putMessageMediaFile } from "./mediaStorage.js";

export type ElevenLabsToolConfig = {
  apiKey: string;
  apiBaseUrl: string;
  voiceId: string;
  modelId: string;
};

export function parseElevenLabsToolConfig(raw: unknown): ElevenLabsToolConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const apiKey = typeof c.apiKey === "string" ? c.apiKey.trim() : "";
  const voiceId = typeof c.voiceId === "string" ? c.voiceId.trim() : "";
  if (!apiKey || apiKey === "***" || !voiceId) return null;
  const apiBaseUrl =
    (typeof c.apiBaseUrl === "string" ? c.apiBaseUrl.trim() : "") || "https://api.elevenlabs.io/v1";
  const modelId =
    (typeof c.modelId === "string" ? c.modelId.trim() : "") || "eleven_multilingual_v2";
  return { apiKey, apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""), voiceId, modelId };
}

export function stripTextForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .trim();
}

export async function synthesizeElevenLabsSpeech(options: {
  config: ElevenLabsToolConfig;
  text: string;
  log: FastifyBaseLogger;
  voiceIdOverride?: string;
}): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const { config, log } = options;
  const speechText = stripTextForSpeech(options.text).slice(0, 5000);
  if (!speechText) return null;

  const voiceId = (options.voiceIdOverride?.trim() || config.voiceId).trim();
  if (!voiceId) return null;

  const url = `${config.apiBaseUrl}/text-to-speech/${encodeURIComponent(voiceId)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: speechText,
        model_id: config.modelId,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errBody = (await res.text().catch(() => "")).slice(0, 500);
      log.warn({ status: res.status, errBody }, "ElevenLabs TTS request failed");
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
    log.warn({ err }, "ElevenLabs TTS synthesis failed");
    return null;
  }
}
