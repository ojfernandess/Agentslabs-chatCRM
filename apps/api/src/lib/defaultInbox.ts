import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const DEFAULT_INBOX_NAME = "Caixa principal";

/**
 * Garante uma caixa por defeito por organização (estilo inbox Chatwoot, fase 1).
 * Idempotente.
 */
export async function ensureDefaultInboxForOrganization(organizationId: string): Promise<{ id: string }> {
  const existing = await prisma.inbox.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const inbox = await tx.inbox.create({
      data: {
        organizationId,
        name: DEFAULT_INBOX_NAME,
        isDefault: true,
      },
    });
    await syncOrgUsersToInboxTx(tx, organizationId, inbox.id);
    return inbox;
  });
}

export async function getDefaultInboxId(organizationId: string): Promise<string> {
  const row = await prisma.inbox.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (row) return row.id;
  const created = await ensureDefaultInboxForOrganization(organizationId);
  return created.id;
}

/** Novo utilizador do tenant passa a ver a caixa por defeito. */
export async function addUserToDefaultInboxes(organizationId: string, userId: string): Promise<void> {
  const defaults = await prisma.inbox.findMany({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (defaults.length === 0) {
    await ensureDefaultInboxForOrganization(organizationId);
    const again = await prisma.inbox.findMany({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    await prisma.inboxMember.createMany({
      data: again.map((i) => ({ inboxId: i.id, userId })),
      skipDuplicates: true,
    });
    return;
  }
  await prisma.inboxMember.createMany({
    data: defaults.map((i) => ({ inboxId: i.id, userId })),
    skipDuplicates: true,
  });
}

async function syncOrgUsersToInboxTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  inboxId: string,
): Promise<void> {
  const users = await tx.user.findMany({
    where: { organizationId },
    select: { id: true },
  });
  if (users.length === 0) return;
  await tx.inboxMember.createMany({
    data: users.map((u) => ({ inboxId, userId: u.id })),
    skipDuplicates: true,
  });
}
