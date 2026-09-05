import {
  buildMem0UserId,
  isMem0Configured,
  mem0AddConversationTurn,
  mem0SearchMemories,
} from "../agent-engine/memory/mem0Client.js";

export function buildTaggingMem0UserId(organizationId: string, contactId: string): string {
  return `${buildMem0UserId(organizationId, contactId)}:tagging`;
}

export async function loadTaggingMem0Context(
  organizationId: string,
  contactId: string,
): Promise<string> {
  if (!isMem0Configured()) return "";
  const userId = buildTaggingMem0UserId(organizationId, contactId);
  try {
    const rows = await mem0SearchMemories({
      userId,
      query: "etiquetas classificação feedback atendimento",
      topK: 5,
    });
    return rows.map((r) => r.memory).filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

export async function storeTaggingFeedbackInMem0(input: {
  organizationId: string;
  contactId: string;
  summary: string;
  approved: boolean;
}): Promise<void> {
  if (!isMem0Configured()) return;
  const userId = buildTaggingMem0UserId(input.organizationId, input.contactId);
  try {
    await mem0AddConversationTurn({
      userId,
      userMessage: `Feedback etiquetagem: ${input.summary}`,
      assistantMessage: input.approved
        ? "Classificação confirmada pelo atendente."
        : "Classificação rejeitada pelo atendente.",
      metadata: { type: "intelligent_tagging_feedback", approved: input.approved },
    });
  } catch {
    /* best-effort */
  }
}
