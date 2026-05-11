import type { Prisma } from "@prisma/client";

/**
 * Filtro Prisma para mensagens enviadas ao agente nativo.
 * Quando `lastClearedAt` está definido (após «Limpar contexto» na automação), exclui mensagens
 * anteriores a essa data — o modelo deixa de ver o histórico antigo (as mensagens na BD mantêm-se).
 */
export function buildNativeAgentMessageWhere(input: {
  conversationId: string;
  excludeMessageId: string;
  lastClearedAt: Date | null;
}): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {
    conversationId: input.conversationId,
    id: { not: input.excludeMessageId },
  };
  if (input.lastClearedAt) {
    where.createdAt = { gt: input.lastClearedAt };
  }
  return where;
}
