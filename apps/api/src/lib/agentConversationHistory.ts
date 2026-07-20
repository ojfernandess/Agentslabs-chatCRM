import type { Prisma } from "@prisma/client";

/** Corte temporal partilhado após «Limpar contexto» ou encerramento com reset de automação. */
export function nativeAgentHistoryCreatedAtFilter(
  lastClearedAt: Date | null,
): Prisma.DateTimeFilter | undefined {
  if (!lastClearedAt) return undefined;
  return { gt: lastClearedAt };
}

/**
 * Filtro Prisma para mensagens enviadas ao agente nativo.
 * Quando `lastClearedAt` está definido (após «Limpar contexto» na automação), exclui mensagens
 * anteriores a essa data — o modelo deixa de ver o histórico antigo (as mensagens na BD mantêm-se).
 * Exclui notas internas (`isPrivate`) para não contaminar o prompt com transferências anteriores.
 */
export function buildNativeAgentMessageWhere(input: {
  conversationId: string;
  excludeMessageId: string;
  lastClearedAt: Date | null;
}): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {
    conversationId: input.conversationId,
    id: { not: input.excludeMessageId },
    isPrivate: false,
  };
  const createdAt = nativeAgentHistoryCreatedAtFilter(input.lastClearedAt);
  if (createdAt) where.createdAt = createdAt;
  return where;
}

/** Transcript público (handoff, assist) respeitando o mesmo corte de contexto do agente nativo. */
export function buildNativeAgentTranscriptWhere(input: {
  conversationId: string;
  lastClearedAt: Date | null;
}): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {
    conversationId: input.conversationId,
    isPrivate: false,
  };
  const createdAt = nativeAgentHistoryCreatedAtFilter(input.lastClearedAt);
  if (createdAt) where.createdAt = createdAt;
  return where;
}

/** Mídia inbound disponível para tools HTTP — só após o último «Limpar contexto». */
export function buildNativeAgentInboundMediaWhere(input: {
  conversationId: string;
  lastClearedAt: Date | null;
}): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {
    conversationId: input.conversationId,
    direction: "INBOUND",
    mediaUrl: { not: null },
    type: { in: ["IMAGE", "DOCUMENT", "VIDEO", "AUDIO"] },
  };
  const createdAt = nativeAgentHistoryCreatedAtFilter(input.lastClearedAt);
  if (createdAt) where.createdAt = createdAt;
  return where;
}
