import type { Contact, Conversation, Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { parseElevenLabsToolConfig, synthesizeElevenLabsSpeech } from "./elevenLabsTts.js";
import { parseAgentVoiceSettings, shouldSendVoiceReply } from "./agentVoiceSettings.js";

export { parseAgentVoiceSettings, shouldSendVoiceReply } from "./agentVoiceSettings.js";
export type { AgentVoiceSettings } from "./agentVoiceSettings.js";

export async function deliverAgentReplyMessage(options: {
  organizationId: string;
  botId: string;
  conversation: Conversation;
  contact: Contact;
  inboundMessage: Message;
  replyText: string;
  behaviorConfig: unknown;
  log: FastifyBaseLogger;
}): Promise<"audio" | "text"> {
  const settings = parseAgentVoiceSettings(options.behaviorConfig);
  const useVoice = shouldSendVoiceReply(settings, options.inboundMessage);

  if (useVoice && settings.elevenLabsToolId) {
    const tool = await prisma.automationCustomTool.findFirst({
      where: {
        id: settings.elevenLabsToolId,
        organizationId: options.organizationId,
        toolType: "ELEVENLABS",
        isActive: true,
      },
    });
    const ttsConfig = tool ? parseElevenLabsToolConfig(tool.config) : null;
    if (ttsConfig) {
      const audio = await synthesizeElevenLabsSpeech({
        config: ttsConfig,
        text: options.replyText,
        log: options.log,
      });
      if (audio) {
        await deliverOutboundWhatsAppMessage({
          organizationId: options.organizationId,
          data: {
            contactId: options.contact.id,
            conversationId: options.conversation.id,
            type: "AUDIO",
            mediaUrl: audio.mediaUrl,
            mediaType: audio.mediaType,
            body: "",
          },
          actor: { kind: "agent_bot", botId: options.botId },
          log: options.log,
          newConversation: { status: "PENDING", assignedToId: null },
        });
        return "audio";
      }
      options.log.warn(
        { botId: options.botId, toolId: settings.elevenLabsToolId },
        "ElevenLabs TTS failed; falling back to text",
      );
    } else {
      options.log.warn(
        { botId: options.botId, toolId: settings.elevenLabsToolId },
        "ElevenLabs tool missing or misconfigured",
      );
    }
  }

  await deliverOutboundWhatsAppMessage({
    organizationId: options.organizationId,
    data: {
      contactId: options.contact.id,
      conversationId: options.conversation.id,
      type: "TEXT",
      body: options.replyText,
    },
    actor: { kind: "agent_bot", botId: options.botId },
    log: options.log,
    newConversation: { status: "PENDING", assignedToId: null },
  });
  return "text";
}
