import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { isAnyNvoipFeatureEnabled } from "./featureFlags.js";
import { getNvoipAccessToken } from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";

/** Renova tokens OAuth antes de expirar (contas CONNECTED). */
export async function runNvoipTokenRefreshTick(log: FastifyBaseLogger): Promise<void> {
  const refreshBefore = new Date(Date.now() + 20 * 60 * 1000);

  const accounts = await prisma.nvoipAccount.findMany({
    where: {
      status: "CONNECTED",
      OR: [{ tokenExpiresAt: { lte: refreshBefore } }, { tokenExpiresAt: null }],
    },
    take: 40,
  });

  for (const account of accounts) {
    const enabled = await isAnyNvoipFeatureEnabled(account.organizationId);
    if (!enabled) continue;

    try {
      await getNvoipAccessToken(account);
    } catch (err) {
      const message = err instanceof Error ? err.message : "token_refresh_failed";
      log.warn({ organizationId: account.organizationId, err: message }, "Nvoip token refresh failed");
      await writeNvoipIntegrationLog({
        organizationId: account.organizationId,
        nvoipAccountId: account.id,
        level: "error",
        eventType: "token_refresh_failed",
        message,
      });
    }
  }
}
