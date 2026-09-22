import { prisma } from "../db.js";
import {
  buildPublicConversationTranscript,
  formatBotTransferHandoffNote,
  generateBotTransferHandoffBrief,
  resolveAssistLlmForOrganization,
} from "./agentAssistLlm.js";
import { buildNativeAgentTranscriptWhere } from "./agentConversationHistory.js";
import { loadAutomationConversationContext } from "./automationConversationContextLib.js";
import { appendTimelineEvent } from "./timeline.js";
import { broadcastToOrganization } from "./workspaceHub.js";
import {
  shouldRevertHandoffAfterValidation,
  type ToolOutcomeLike,
} from "./agent-engine/validators/handoffRevert.js";
import type { TurnPolicy } from "./agent-engine/validators/turnPolicyParser.js";

export { shouldRevertHandoffAfterValidation, type ToolOutcomeLike };

export type NativeHandoffToolName = "transfer_to_team" | "assign_team_to_conversation" | "call_human";

export function parseRegisterHandoffInConversationFromBehavior(behaviorConfig: unknown): boolean {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return false;
  const esc = (behaviorConfig as Record<string, unknown>).escalationRules;
  if (!esc || typeof esc !== "object") return false;
  return (esc as Record<string, unknown>).registerHandoffInConversation === true;
}

export async function resolveCallHumanRegistrationOptions(
  organizationId: string,
  conversationId: string,
  botId?: string | null,
): Promise<{ registerInConversation: boolean; botName: string | null }> {
  const resolvedBotId = typeof botId === "string" && botId.trim() ? botId.trim() : null;
  if (!resolvedBotId) {
    return { registerInConversation: false, botName: null };
  }
  const [bot, profile] = await Promise.all([
    prisma.bot.findFirst({
      where: { id: resolvedBotId, organizationId },
      select: { name: true },
    }),
    prisma.automationAgentProfile.findUnique({
      where: { botId: resolvedBotId },
      select: { behaviorConfig: true },
    }),
  ]);
  return {
    registerInConversation: parseRegisterHandoffInConversationFromBehavior(profile?.behaviorConfig),
    botName: bot?.name?.trim() || null,
  };
}

/** Regista evento visível na conversa (timeline + toast) quando call_human do bot está configurado. */
export async function registerBotCallHumanInConversation(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  contactName: string | null;
  botName?: string | null;
  previousTeamId: string | null;
  previousTeamName: string | null;
  newTeamId: string | null;
  newTeamName: string | null;
  previousAssignedToId: string | null;
  previousAssigneeName: string | null;
}): Promise<void> {
  await appendTimelineEvent({
    organizationId: input.organizationId,
    subjectType: "CONTACT",
    subjectId: input.contactId,
    eventType: "conversation.handoff",
    channel: "conversation",
    payload: {
      conversationId: input.conversationId,
      handoffSource: "call_human",
      botName: input.botName ?? null,
      previousTeamId: input.previousTeamId,
      previousTeamName: input.previousTeamName,
      newTeamId: input.newTeamId,
      newTeamName: input.newTeamName,
      previousAssigneeId: input.previousAssignedToId,
      previousAssigneeName: input.previousAssigneeName,
      newAssigneeId: null,
      newAssigneeName: null,
    },
    actorUserId: null,
    sourceId: input.conversationId,
  });

  broadcastToOrganization(input.organizationId, {
    type: "conversation.transferred",
    conversationId: input.conversationId,
    teamId: input.newTeamId,
    teamName: input.newTeamName,
    previousTeamId: input.previousTeamId,
    assignedToId: null,
    previousAssignedToId: input.previousAssignedToId,
    handoffSource: "call_human",
    botName: input.botName ?? null,
    contact: input.contactName ? { name: input.contactName } : undefined,
  });
  broadcastToOrganization(input.organizationId, {
    type: "conversation.updated",
    conversationId: input.conversationId,
    awaitingHumanHandoff: true,
  });
}

/**
 * Marca a conversa como «à espera de humano», grava nota interna (resumo inteligente + motivo) e notifica o workspace.
 * Não envia WhatsApp — só `Message` com `isPrivate: true`.
 */
export async function recordNativeAgentTransferHandoff(input: {
  organizationId: string;
  conversationId: string;
  toolName: NativeHandoffToolName;
  reason: string | null;
  userMessageSnippet: string;
  teamName: string | null;
}): Promise<void> {
  let brief = null;
  try {
    const [conv, assist, automationCtx] = await Promise.all([
      prisma.conversation.findFirst({
        where: { id: input.conversationId, organizationId: input.organizationId },
        select: {
          contact: { select: { name: true } },
        },
      }),
      resolveAssistLlmForOrganization(input.organizationId),
      loadAutomationConversationContext(input.conversationId),
    ]);
    const messages = await prisma.message.findMany({
      where: buildNativeAgentTranscriptWhere({
        conversationId: input.conversationId,
        lastClearedAt: automationCtx.lastClearedAt,
      }),
      orderBy: { createdAt: "asc" },
      take: 60,
      select: { direction: true, body: true, isPrivate: true },
    });
    if (conv && assist.ok) {
      const transcript = buildPublicConversationTranscript(messages, 45);
      brief = await generateBotTransferHandoffBrief(
        {
          contactName: conv.contact?.name ?? "",
          transcript,
          transferReason: input.reason,
          language: "pt",
        },
        assist.ctx,
        { conversationId: input.conversationId },
      );
    }
  } catch {
    brief = null;
  }

  const body = formatBotTransferHandoffNote({
    toolName: input.toolName,
    teamName: input.teamName,
    reason: input.reason,
    brief,
    fallbackSnippet: input.userMessageSnippet,
  });

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { awaitingHumanHandoff: true, updatedAt: new Date() },
    });
    await tx.message.create({
      data: {
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        type: "TEXT",
        body,
        isPrivate: true,
        status: "SENT",
      },
    });
  });

  broadcastToOrganization(input.organizationId, {
    type: "conversation.updated",
    conversationId: input.conversationId,
    awaitingHumanHandoff: true,
  });
}

/**
 * Reverte handoff quando transfer/status correu mas a validação de turno reprovou.
 * Evita outbound de escalonamento após retry ou strict block.
 */
export async function revertNativeAgentIllegalHandoff(input: {
  organizationId: string;
  conversationId: string;
  reason: string;
}): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, awaitingHumanHandoff: true },
  });
  if (!conv?.awaitingHumanHandoff) return false;

  const note = `[Sistema] Handoff automático revertido — ${input.reason}`.slice(0, 4000);

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { awaitingHumanHandoff: false, updatedAt: new Date() },
    });
    await tx.message.create({
      data: {
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        type: "TEXT",
        body: note,
        isPrivate: true,
        status: "SENT",
      },
    });
  });

  broadcastToOrganization(input.organizationId, {
    type: "conversation.updated",
    conversationId: input.conversationId,
    awaitingHumanHandoff: false,
  });
  return true;
}

/** Reverte handoff se validação detectou escalonamento ilegal neste turno. */
export async function maybeRevertIllegalHandoffAfterValidation(input: {
  organizationId: string;
  conversationId: string;
  toolOutcomes: ToolOutcomeLike[];
  validationAlerts: string[];
  turnPolicy?: TurnPolicy | null;
}): Promise<boolean> {
  if (
    !shouldRevertHandoffAfterValidation(
      input.toolOutcomes,
      input.validationAlerts,
      input.turnPolicy,
    )
  ) {
    return false;
  }
  const summary = input.validationAlerts.slice(0, 2).join("; ") || "política de turno";
  return revertNativeAgentIllegalHandoff({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    reason: summary,
  });
}
