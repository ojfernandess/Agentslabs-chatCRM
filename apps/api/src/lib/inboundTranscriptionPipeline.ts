import type { Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { parseAgentEngineConfig } from "./agent-engine/config/parseAgentEngineConfig.js";
import { getCachedAutomationAgentProfile } from "./cachedAutomationAgentProfile.js";
import type { AgentBotDispatchContext } from "./agentBotTriage.js";
import { maybeTranscribeInboundAudioMessage } from "./audioTranscription.js";
import { maybeTranscribeInboundImageMessage } from "./imageTranscription.js";
import { broadcastConversationMessageUpdated } from "./workspaceMessageBroadcast.js";

export type InboundTranscriptionSettings = {
  audioTranscriptionEnabled: boolean;
  imageTranscriptionEnabled: boolean;
};

export function inboundMessageNeedsTranscription(
  message: Message,
  settings: InboundTranscriptionSettings,
): boolean {
  if (message.body?.trim()) return false;
  if (message.type === "AUDIO" && settings.audioTranscriptionEnabled && message.mediaUrl?.trim()) {
    return true;
  }
  if (message.type === "IMAGE" && settings.imageTranscriptionEnabled && message.mediaUrl?.trim()) {
    return true;
  }
  return false;
}

export async function transcribeInboundMediaMessage(input: {
  message: Message;
  audioTranscriptionEnabled: boolean;
  imageTranscriptionEnabled: boolean;
  log: FastifyBaseLogger;
}): Promise<Message> {
  let result = await maybeTranscribeInboundAudioMessage({
    message: input.message,
    enabled: input.audioTranscriptionEnabled,
    log: input.log,
  });
  result = await maybeTranscribeInboundImageMessage({
    message: result,
    enabled: input.imageTranscriptionEnabled,
    log: input.log,
  });
  return result;
}

export function startInboundMediaTranscription(input: {
  message: Message;
  audioTranscriptionEnabled: boolean;
  imageTranscriptionEnabled: boolean;
  log: FastifyBaseLogger;
}): { promise: Promise<Message>; needsTranscription: boolean } {
  const needsTranscription = inboundMessageNeedsTranscription(input.message, {
    audioTranscriptionEnabled: input.audioTranscriptionEnabled,
    imageTranscriptionEnabled: input.imageTranscriptionEnabled,
  });
  const promise = transcribeInboundMediaMessage(input);
  return { promise, needsTranscription };
}

/** `timeoutMs <= 0` aguarda sem limite. */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function broadcastInboundMessageTranscriptionUpdated(
  organizationId: string,
  conversationId: string,
  message: Pick<Message, "id" | "status" | "body" | "providerError">,
): void {
  broadcastConversationMessageUpdated(organizationId, conversationId, {
    id: message.id,
    status: message.status,
    providerError: message.providerError ?? null,
    body: message.body,
  });
}

function scheduleTranscriptionBodyBroadcast(input: {
  transcription: { promise: Promise<Message> };
  original: Message;
  organizationId: string;
  conversationId: string;
  log: FastifyBaseLogger;
}): void {
  void input.transcription.promise
    .then((updated) => {
      if ((updated.body?.trim() ?? "") === (input.original.body?.trim() ?? "")) return;
      broadcastInboundMessageTranscriptionUpdated(
        input.organizationId,
        input.conversationId,
        updated,
      );
    })
    .catch((err) => {
      input.log.warn(
        { err, messageId: input.original.id },
        "Background inbound transcription failed",
      );
    });
}

export async function resolveWaitForInboundTranscription(
  organizationId: string,
  agentCtx: AgentBotDispatchContext | null,
): Promise<boolean> {
  if (!agentCtx) return true;
  const profile = await getCachedAutomationAgentProfile(agentCtx.agentBotId, organizationId);
  return parseAgentEngineConfig(profile?.behaviorConfig).waitForInboundTranscription !== false;
}

export type InboundTranscriptionGateInput = {
  organizationId: string;
  conversationId: string;
  message: Message;
  transcription: { promise: Promise<Message>; needsTranscription: boolean };
  waitForTranscription: boolean;
  transcriptionTimeoutMs: number;
  log: FastifyBaseLogger;
};

export type InboundTranscriptionPipelineResult = {
  message: Message;
  timedOut: boolean;
};

/**
 * Aguarda transcrição (com timeout) ou deixa em background conforme flag do bot.
 */
export async function awaitInboundTranscriptionGate(
  input: InboundTranscriptionGateInput,
): Promise<InboundTranscriptionPipelineResult> {
  const { transcription } = input;

  if (!transcription.needsTranscription) {
    const resolved = await transcription.promise;
    return { message: resolved, timedOut: false };
  }

  if (!input.waitForTranscription) {
    scheduleTranscriptionBodyBroadcast({
      transcription,
      original: input.message,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      log: input.log,
    });
    return { message: input.message, timedOut: false };
  }

  const updated = await raceWithTimeout(
    transcription.promise,
    input.transcriptionTimeoutMs,
    input.message,
  );
  const timedOut =
    input.transcriptionTimeoutMs > 0 &&
    (updated.body?.trim() ?? "") === (input.message.body?.trim() ?? "");

  if (timedOut) {
    input.log.warn(
      { messageId: input.message.id, timeoutMs: input.transcriptionTimeoutMs },
      "Inbound transcription timed out before bot dispatch",
    );
    scheduleTranscriptionBodyBroadcast({
      transcription,
      original: input.message,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      log: input.log,
    });
    return { message: input.message, timedOut: true };
  }

  if ((updated.body?.trim() ?? "") !== (input.message.body?.trim() ?? "")) {
    broadcastInboundMessageTranscriptionUpdated(
      input.organizationId,
      input.conversationId,
      updated,
    );
  }

  return { message: updated, timedOut: false };
}

export type InboundTranscriptionPipelineInput = {
  organizationId: string;
  conversationId: string;
  message: Message;
  audioTranscriptionEnabled: boolean;
  imageTranscriptionEnabled: boolean;
  waitForTranscription: boolean;
  transcriptionTimeoutMs: number;
  log: FastifyBaseLogger;
};

/**
 * Fase A2 — inicia transcrição e aplica gate configurável antes do bot.
 */
export async function runInboundTranscriptionPipeline(
  input: InboundTranscriptionPipelineInput,
): Promise<InboundTranscriptionPipelineResult> {
  const transcription = startInboundMediaTranscription({
    message: input.message,
    audioTranscriptionEnabled: input.audioTranscriptionEnabled,
    imageTranscriptionEnabled: input.imageTranscriptionEnabled,
    log: input.log,
  });
  return awaitInboundTranscriptionGate({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    message: input.message,
    transcription,
    waitForTranscription: input.waitForTranscription,
    transcriptionTimeoutMs: input.transcriptionTimeoutMs,
    log: input.log,
  });
}
