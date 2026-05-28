import { prisma } from "../db.js";
import {
  buildPublicConversationTranscript,
  formatBotTransferHandoffNote,
  generateBotTransferHandoffBrief,
  getAssistOpenAiCredentialsForOrganization,
} from "./agentAssistLlm.js";
import { broadcastToOrganization } from "./workspaceHub.js";

export type NativeHandoffToolName = "transfer_to_team" | "assign_team_to_conversation" | "call_human";

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
    const [conv, credentials] = await Promise.all([
      prisma.conversation.findFirst({
        where: { id: input.conversationId, organizationId: input.organizationId },
        select: {
          contact: { select: { name: true } },
          messages: {
            orderBy: { createdAt: "asc" },
            take: 60,
            select: { direction: true, body: true, isPrivate: true },
          },
        },
      }),
      getAssistOpenAiCredentialsForOrganization(input.organizationId),
    ]);
    if (conv && credentials) {
      const transcript = buildPublicConversationTranscript(conv.messages, 45);
      brief = await generateBotTransferHandoffBrief(
        {
          contactName: conv.contact?.name ?? "",
          transcript,
          transferReason: input.reason,
          language: "pt",
        },
        credentials,
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
