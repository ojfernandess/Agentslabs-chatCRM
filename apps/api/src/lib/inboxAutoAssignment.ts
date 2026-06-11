import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { broadcastConversationUpdated } from "./workspaceHub.js";

/**
 * Escolhe o membro da caixa com menos conversas ativas (OPEN/PENDING) atribuídas,
 * respeitando `autoAssignLimit` quando definido.
 */
export async function pickAutoAssigneeForInbox(
  inboxId: string,
  organizationId: string,
): Promise<string | null> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId },
    select: { autoAssignEnabled: true, autoAssignLimit: true },
  });
  if (!inbox?.autoAssignEnabled) return null;

  const members = await prisma.inboxMember.findMany({
    where: { inboxId },
    select: { userId: true },
  });
  if (members.length === 0) return null;

  const memberIds = members.map((m) => m.userId);
  const counts = await prisma.conversation.groupBy({
    by: ["assignedToId"],
    where: {
      organizationId,
      inboxId,
      assignedToId: { in: memberIds },
      status: { in: ["OPEN", "PENDING"] },
    },
    _count: { id: true },
  });

  const loadByUser = new Map<string, number>();
  for (const uid of memberIds) loadByUser.set(uid, 0);
  for (const row of counts) {
    if (row.assignedToId) loadByUser.set(row.assignedToId, row._count.id);
  }

  const limit = inbox.autoAssignLimit;
  let bestId: string | null = null;
  let bestLoad = Number.POSITIVE_INFINITY;

  for (const uid of memberIds) {
    const load = loadByUser.get(uid) ?? 0;
    if (limit != null && load >= limit) continue;
    if (load < bestLoad) {
      bestLoad = load;
      bestId = uid;
    }
  }

  return bestId;
}

export async function tryAutoAssignInboxConversation(params: {
  conversationId: string;
  inboxId: string;
  organizationId: string;
  log?: FastifyBaseLogger;
}): Promise<boolean> {
  const { conversationId, inboxId, organizationId, log } = params;

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId, inboxId },
    select: { id: true, status: true, assignedToId: true },
  });
  if (!conv || conv.assignedToId != null || conv.status !== "OPEN") {
    return false;
  }

  const assigneeId = await pickAutoAssigneeForInbox(inboxId, organizationId);
  if (!assigneeId) return false;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { assignedToId: assigneeId, updatedAt: new Date() },
  });

  broadcastConversationUpdated(organizationId, conversationId);
  log?.info({ conversationId, inboxId, assigneeId }, "inbox_auto_assign_applied");
  return true;
}
