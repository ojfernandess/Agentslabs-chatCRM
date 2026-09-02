import type { Prisma } from "@prisma/client";

/**
 * Reatribui FKs com ON DELETE RESTRICT antes de apagar um utilizador.
 * Mantém integridade referencial (audit, convites, etc.) sem bloquear o delete.
 */
export async function reassignUserRestrictReferences(
  tx: Prisma.TransactionClient,
  userId: string,
  reassignToUserId: string,
): Promise<void> {
  if (userId === reassignToUserId) return;

  await tx.auditLog.updateMany({
    where: { actorUserId: userId },
    data: { actorUserId: reassignToUserId },
  });
  await tx.platformApplication.updateMany({
    where: { createdById: userId },
    data: { createdById: reassignToUserId },
  });
  await tx.broadcastCampaign.updateMany({
    where: { createdById: userId },
    data: { createdById: reassignToUserId },
  });
  await tx.automationKnowledgeRevision.updateMany({
    where: { editorUserId: userId },
    data: { editorUserId: reassignToUserId },
  });
  await tx.userInvitation.updateMany({
    where: { invitedById: userId },
    data: { invitedById: reassignToUserId },
  });
  await tx.conversationClosureRecord.updateMany({
    where: { resolvedById: userId },
    data: { resolvedById: reassignToUserId },
  });
}
