import { ChatbotFlowSessionStatus } from "@prisma/client";
import { prisma } from "../db.js";

export interface ChatbotFlowAnalytics {
  sessionsTotal: number;
  sessionsLast7Days: number;
  byStatus: Record<string, number>;
  completionRate: number;
  invalidInputCount: number;
  interactionsLast7Days: number;
  updatedAt: string;
}

export async function loadChatbotFlowAnalytics(
  organizationId: string,
  chatbotFlowId: string,
): Promise<ChatbotFlowAnalytics> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [grouped, total, recentCount, interactions] = await Promise.all([
    prisma.chatbotFlowSession.groupBy({
      by: ["status"],
      where: { organizationId, chatbotFlowId },
      _count: { _all: true },
    }),
    prisma.chatbotFlowSession.count({ where: { organizationId, chatbotFlowId } }),
    prisma.chatbotFlowSession.count({
      where: { organizationId, chatbotFlowId, createdAt: { gte: since } },
    }),
    prisma.automationInteraction.findMany({
      where: {
        organizationId,
        responseType: "visual_chatbot",
        createdAt: { gte: since },
      },
      select: { metadata: true },
      take: 5000,
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of grouped) {
    byStatus[row.status] = row._count._all;
  }
  const completed = byStatus[ChatbotFlowSessionStatus.COMPLETED] ?? 0;
  const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

  let invalidInputCount = 0;
  let interactionsForFlow = 0;
  for (const row of interactions) {
    const meta = row.metadata as Record<string, unknown> | null;
    if (meta?.chatbotFlowId !== chatbotFlowId) continue;
    interactionsForFlow += 1;
    if (meta.invalidInput === true) invalidInputCount += 1;
  }

  return {
    sessionsTotal: total,
    sessionsLast7Days: recentCount,
    byStatus,
    completionRate,
    invalidInputCount,
    interactionsLast7Days: interactionsForFlow,
    updatedAt: new Date().toISOString(),
  };
}
