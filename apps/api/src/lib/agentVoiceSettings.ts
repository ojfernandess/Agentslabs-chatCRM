import type { Message } from "@prisma/client";

export type AgentVoiceSettings = {
  nativeVoiceEnabled: boolean;
  nativeVoiceResponsePercent: number;
  inboundAudioResponsePercent: number;
  elevenLabsEnabled: boolean;
  elevenLabsToolId: string | null;
  voiceResponsePercent: number;
  replyWithAudioOnInboundAudio: boolean;
  replyWithTextOnInboundAudio: boolean;
};

function clampPercent(n: unknown, fallback: number): number {
  return Math.min(100, Math.max(0, Number(n ?? fallback)));
}

function rollVoicePercent(percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return Math.random() * 100 < percent;
}

export function parseAgentVoiceSettings(behaviorConfig: unknown): AgentVoiceSettings {
  const defaults: AgentVoiceSettings = {
    nativeVoiceEnabled: false,
    nativeVoiceResponsePercent: 100,
    inboundAudioResponsePercent: 100,
    elevenLabsEnabled: false,
    elevenLabsToolId: null,
    voiceResponsePercent: 100,
    replyWithAudioOnInboundAudio: false,
    replyWithTextOnInboundAudio: false,
  };
  if (!behaviorConfig || typeof behaviorConfig !== "object") return defaults;
  const voice = (behaviorConfig as Record<string, unknown>).voice;
  if (!voice || typeof voice !== "object") return defaults;
  const v = voice as Record<string, unknown>;
  const elevenLabsEnabled = v.elevenLabsEnabled === true;
  const legacyPercent = clampPercent(v.voiceResponsePercent, 100);
  const nativeVoiceResponsePercent = clampPercent(
    v.nativeVoiceResponsePercent ?? v.voiceResponsePercent,
    100,
  );
  return {
    nativeVoiceEnabled:
      v.nativeVoiceEnabled === true ||
      (!elevenLabsEnabled && legacyPercent > 0 && v.replyWithAudioOnInboundAudio !== true),
    nativeVoiceResponsePercent,
    inboundAudioResponsePercent: clampPercent(v.inboundAudioResponsePercent, 100),
    elevenLabsEnabled,
    elevenLabsToolId:
      typeof v.elevenLabsToolId === "string" && v.elevenLabsToolId.trim()
        ? v.elevenLabsToolId.trim()
        : null,
    voiceResponsePercent: legacyPercent,
    replyWithAudioOnInboundAudio: v.replyWithAudioOnInboundAudio === true,
    replyWithTextOnInboundAudio: v.replyWithTextOnInboundAudio === true,
  };
}

export function shouldSendVoiceReply(
  settings: AgentVoiceSettings,
  inboundMessage: Pick<Message, "type">,
): boolean {
  const elevenLabsActive = settings.elevenLabsEnabled && Boolean(settings.elevenLabsToolId);

  if (inboundMessage.type === "AUDIO") {
    if (settings.replyWithTextOnInboundAudio) return false;
    if (settings.replyWithAudioOnInboundAudio) {
      if (elevenLabsActive) return rollVoicePercent(settings.voiceResponsePercent);
      return rollVoicePercent(settings.inboundAudioResponsePercent);
    }
  }

  if (elevenLabsActive) return rollVoicePercent(settings.voiceResponsePercent);
  if (settings.nativeVoiceEnabled) return rollVoicePercent(settings.nativeVoiceResponsePercent);
  return false;
}
