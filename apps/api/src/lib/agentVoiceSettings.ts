import type { Message } from "@prisma/client";

export type AgentVoiceSettings = {
  elevenLabsEnabled: boolean;
  elevenLabsToolId: string | null;
  voiceResponsePercent: number;
  replyWithAudioOnInboundAudio: boolean;
};

export function parseAgentVoiceSettings(behaviorConfig: unknown): AgentVoiceSettings {
  const defaults: AgentVoiceSettings = {
    elevenLabsEnabled: false,
    elevenLabsToolId: null,
    voiceResponsePercent: 100,
    replyWithAudioOnInboundAudio: false,
  };
  if (!behaviorConfig || typeof behaviorConfig !== "object") return defaults;
  const voice = (behaviorConfig as Record<string, unknown>).voice;
  if (!voice || typeof voice !== "object") return defaults;
  const v = voice as Record<string, unknown>;
  return {
    elevenLabsEnabled: v.elevenLabsEnabled === true,
    elevenLabsToolId:
      typeof v.elevenLabsToolId === "string" && v.elevenLabsToolId.trim()
        ? v.elevenLabsToolId.trim()
        : null,
    voiceResponsePercent: Math.min(100, Math.max(0, Number(v.voiceResponsePercent ?? 100))),
    replyWithAudioOnInboundAudio: v.replyWithAudioOnInboundAudio === true,
  };
}

export function shouldSendVoiceReply(
  settings: AgentVoiceSettings,
  inboundMessage: Pick<Message, "type">,
): boolean {
  if (!settings.elevenLabsEnabled || !settings.elevenLabsToolId) return false;
  if (settings.replyWithAudioOnInboundAudio && inboundMessage.type === "AUDIO") return true;
  if (settings.voiceResponsePercent <= 0) return false;
  if (settings.voiceResponsePercent >= 100) return true;
  return Math.random() * 100 < settings.voiceResponsePercent;
}
