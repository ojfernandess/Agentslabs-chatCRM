import type { NvoipAccount } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { nvoipListUsers, type NvoipSipUserItem } from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";

export async function syncNvoipSipUsers(
  account: NvoipAccount,
): Promise<{ synced: number; users: NvoipSipUserItem[] }> {
  const remote = await nvoipListUsers(account);
  const now = new Date();

  for (const u of remote) {
    await prisma.nvoipSipUser.upsert({
      where: {
        nvoipAccountId_numbersip: { nvoipAccountId: account.id, numbersip: u.numbersip },
      },
      create: {
        organizationId: account.organizationId,
        nvoipAccountId: account.id,
        numbersip: u.numbersip,
        name: u.name || null,
        caller: u.caller || null,
        blocked: u.blocked,
        webphone: u.webphone,
        rawPayload: u.raw as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      },
      update: {
        name: u.name || null,
        caller: u.caller || null,
        blocked: u.blocked,
        webphone: u.webphone,
        rawPayload: u.raw as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      },
    });
  }

  await writeNvoipIntegrationLog({
    organizationId: account.organizationId,
    nvoipAccountId: account.id,
    level: "info",
    eventType: "directory_sync",
    message: `Synced ${remote.length} SIP user(s) from /list/users`,
  });

  return { synced: remote.length, users: remote };
}

export async function listCachedNvoipSipUsers(nvoipAccountId: string) {
  return prisma.nvoipSipUser.findMany({
    where: { nvoipAccountId },
    orderBy: [{ name: "asc" }, { numbersip: "asc" }],
  });
}
