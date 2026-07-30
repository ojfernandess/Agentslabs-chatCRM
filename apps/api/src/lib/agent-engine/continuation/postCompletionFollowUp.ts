import { randomUUID } from "node:crypto";
import type { Bot, Contact, Conversation, Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../../db.js";
import { startAutomationExecution } from "../../automationExecutionLog.js";
import { parseAgentEngineConfig } from "../config/parseAgentEngineConfig.js";
import {
  completionToolSatisfiedThisTurn,
  resolveTurnPolicy,
} from "../validators/turnPolicyParser.js";

/** Prefixo em `providerMsgId` das mensagens sintéticas de follow-up (não vêm do WhatsApp). */
export const POST_COMPLETION_FOLLOWUP_PROVIDER_PREFIX = "oc:post-completion-follow-up:";

/** Ack curto típico (S10) — se a reply for muito longa, assume Passo 8 já enviado. */
export const POST_COMPLETION_FOLLOWUP_MAX_ACK_CHARS = 280;

/**
 * Texto sintético que NÃO casa com CONFIRMATION_USER_MSG_RE ("ok"/"sim"),
 * para o turno Passo 8 não reabrir exclusive de gate.
 */
export const DEFAULT_POST_COMPLETION_FOLLOWUP_TEXT = "envie os detalhes da estadia";

export function isPostCompletionFollowUpMessage(message: {
  providerMsgId?: string | null;
}): boolean {
  return (
    typeof message.providerMsgId === "string" &&
    message.providerMsgId.startsWith(POST_COMPLETION_FOLLOWUP_PROVIDER_PREFIX)
  );
}

export function resolvePostCompletionFollowUpSyntheticText(behaviorConfig: unknown): string {
  const engine = parseAgentEngineConfig(behaviorConfig);
  const raw = engine.postCompletionFollowUpSyntheticText?.trim();
  if (raw) return raw.slice(0, 200);
  return DEFAULT_POST_COMPLETION_FOLLOWUP_TEXT;
}

export type ShouldSchedulePostCompletionFollowUpInput = {
  enabled: boolean;
  skip?: boolean;
  replyText: string;
  toolOutcomes: Array<{ name: string; ok?: boolean }>;
  behaviorConfig: unknown;
  userMessage?: string;
  /** Se a mensagem actual já é o follow-up sintético. */
  isFollowUpMessage?: boolean;
};

/**
 * Decide se deve agendar um 2.º turno (S11 / Passo 8) após tool de conclusão OK + ack curto.
 * Genérico — não hardcoda nomes de tools de um segmento.
 *
 * Importante: resolve política SEM userMessage de confirmação, para hints de conclusão
 * não dependerem do "sim" do hóspede (e para toolOutcomes vazios falharem cedo).
 */
export function shouldSchedulePostCompletionFollowUp(
  input: ShouldSchedulePostCompletionFollowUpInput,
): boolean {
  if (input.skip || input.isFollowUpMessage) return false;
  if (!input.enabled) return false;
  const reply = (input.replyText ?? "").trim();
  if (!reply) return false;
  if (reply.length > POST_COMPLETION_FOLLOWUP_MAX_ACK_CHARS) return false;
  if (!input.toolOutcomes.length) return false;

  const behavior =
    input.behaviorConfig && typeof input.behaviorConfig === "object"
      ? (input.behaviorConfig as Record<string, unknown>)
      : {};
  // Sem userMessage: evita exclusive de gate no "sim" e foca só nos completion hints.
  const policy = resolveTurnPolicy(behavior, {});
  return completionToolSatisfiedThisTurn(policy, input.toolOutcomes);
}

export type RunPostCompletionFollowUpDeps = {
  runNativeAgentReplyAndDeliver: (input: {
    organizationId: string;
    bot: Bot;
    conversation: Conversation;
    contact: Contact;
    message: Message;
    log: FastifyBaseLogger;
    exLog: Awaited<ReturnType<typeof startAutomationExecution>>;
    skipPostCompletionFollowUp?: boolean;
  }) => Promise<void>;
};

/**
 * Cria inbound sintético e corre um novo turno nativo (Passo 8 / pós-conclusão).
 * Não envia nada ao canal do contacto como inbound — só grava Message INBOUND na BD.
 */
export async function runPostCompletionFollowUp(input: {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  contact: Contact;
  sourceMessage: Message;
  behaviorConfig: unknown;
  log: FastifyBaseLogger;
  deps: RunPostCompletionFollowUpDeps;
}): Promise<{ scheduled: boolean; followUpMessageId?: string }> {
  const syntheticText = resolvePostCompletionFollowUpSyntheticText(input.behaviorConfig);
  const followUpMessage = await prisma.message.create({
    data: {
      conversationId: input.conversation.id,
      direction: "INBOUND",
      type: "TEXT",
      body: syntheticText,
      status: "SENT",
      providerMsgId: `${POST_COMPLETION_FOLLOWUP_PROVIDER_PREFIX}${randomUUID()}`,
    },
  });

  const exLog = await startAutomationExecution({
    organizationId: input.organizationId,
    botId: input.bot.id,
    conversationId: input.conversation.id,
    triggerMessageId: followUpMessage.id,
    workflowKey: "native_agent_post_completion",
    workflowName: `${input.bot.name.slice(0, 160)} · pós-conclusão`,
    log: input.log,
  });

  exLog.info(
    { id: "post_completion_follow_up", name: "Follow-up pós-conclusão" },
    "Turno sintético agendado após tool de conclusão OK (sem resposta do contacto)",
    {
      input: {
        sourceMessageId: input.sourceMessage.id,
        followUpMessageId: followUpMessage.id,
        syntheticText: syntheticText.slice(0, 80),
      },
    },
  );

  try {
    await input.deps.runNativeAgentReplyAndDeliver({
      organizationId: input.organizationId,
      bot: input.bot,
      conversation: input.conversation,
      contact: input.contact,
      message: followUpMessage,
      log: input.log,
      exLog,
      skipPostCompletionFollowUp: true,
    });
  } catch (err) {
    input.log.warn(
      { err, botId: input.bot.id, followUpMessageId: followUpMessage.id },
      "post-completion follow-up failed",
    );
    await exLog.completeError(err);
    return { scheduled: true, followUpMessageId: followUpMessage.id };
  }

  return { scheduled: true, followUpMessageId: followUpMessage.id };
}
