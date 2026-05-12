import { prisma } from "../db.js";
import { broadcastToOrganization } from "./workspaceHub.js";

export type NativeHandoffToolName = "transfer_to_team" | "assign_team_to_conversation" | "call_human";

/**
 * Marca a conversa como «à espera de humano», grava nota interna (resumo + motivo) e notifica o workspace.
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
  const reasonLine = input.reason?.trim() || "(não indicado)";
  const summary = (input.userMessageSnippet ?? "").trim().slice(0, 800) || "(sem texto)";
  const body = [
    "[Nota interna — transferência do assistente automático]",
    `Ferramenta: ${input.toolName}`,
    input.teamName ? `Equipe: ${input.teamName}` : null,
    `Motivo: ${reasonLine}`,
    `Resumo (última mensagem do cliente): ${summary}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

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
