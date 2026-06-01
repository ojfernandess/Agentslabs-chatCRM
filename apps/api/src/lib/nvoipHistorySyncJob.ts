import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { syncNvoipInboundHistoryForAccount } from "./nvoipInboundSync.js";

/** Sincroniza chamadas inbound via GET /calls/history (polling — sem webhooks públicos). */
export async function runNvoipHistorySyncTick(log: FastifyBaseLogger): Promise<void> {
  const accounts = await prisma.nvoipAccount.findMany({
    where: { status: "CONNECTED" },
    take: 40,
    orderBy: { lastStatusAt: "asc" },
  });

  let synced = 0;
  for (const account of accounts) {
    const enabled = await isOrganizationFeatureEnabled(account.organizationId, "nvoip_voice");
    if (!enabled) continue;

    try {
      const stats = await syncNvoipInboundHistoryForAccount(account);
      synced += 1;
      if (stats.created > 0 || stats.screenPops > 0) {
        log.info(
          {
            organizationId: account.organizationId,
            accountId: account.id,
            ...stats,
          },
          "nvoip inbound history sync",
        );
      }
    } catch (err) {
      log.warn(
        { err, organizationId: account.organizationId, accountId: account.id },
        "nvoip history sync tick failed for account",
      );
    }
  }

  if (synced > 0) {
    log.debug({ accounts: synced }, "nvoip history sync tick completed");
  }
}
