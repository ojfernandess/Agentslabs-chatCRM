import type { NvoipAccount } from "@prisma/client";
import { prisma } from "../db.js";
import {
  nvoipGetSipUser,
  nvoipListDids,
  nvoipListUsers,
  nvoipSameNumbersip,
  nvoipSetUserPanelAccess,
  nvoipUpdateDid,
} from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";
import { parseNvoipPabxMode } from "./nvoipPabxConfig.js";
import {
  buildProfileDidDestination,
  didDestinationMatches,
  shouldRouteDidToProfileRamais,
} from "./nvoipProfileRamais.js";

async function listProfileRamais(organizationId: string): Promise<string[]> {
  const rows = await prisma.userSipCredentials.findMany({
    where: {
      user: {
        OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
      },
    },
    select: { sipUser: true },
  });

  const ramais = new Set<string>();
  for (const row of rows) {
    const numbersip = row.sipUser.replace(/\D/g, "");
    if (numbersip.length < 3 || numbersip.length > 16) continue;
    ramais.add(numbersip);
  }
  return [...ramais].sort((a, b) => a.localeCompare(b));
}

/**
 * Bloqueia o login do painel Nvoip nos ramais do perfil.
 * PUT /users/{id}/panel-access-status não altera a conta SIP.
 */
async function releaseProfileRamaisFromPanelWebphone(
  account: NvoipAccount,
  ramais: string[],
): Promise<void> {
  let users;
  try {
    users = await nvoipListUsers(account);
  } catch (err) {
    await writeNvoipIntegrationLog({
      organizationId: account.organizationId,
      nvoipAccountId: account.id,
      level: "warn",
      eventType: "profile_ramal_webphone_release_failed",
      message: err instanceof Error ? err.message : "profile_ramal_webphone_release_failed",
      payload: { ramais },
    }).catch(() => {});
    return;
  }

  await Promise.all(
    ramais.map(async (numbersip) => {
      const match = users.find(
        (user) =>
          nvoipSameNumbersip(user.numbersip, numbersip) ||
          nvoipSameNumbersip(user.caller, numbersip),
      );
      if (!match?.id) {
        await writeNvoipIntegrationLog({
          organizationId: account.organizationId,
          nvoipAccountId: account.id,
          level: "warn",
          eventType: "profile_ramal_webphone_release_failed",
          message: "profile_ramal_user_not_found",
          payload: { numbersip },
        }).catch(() => {});
        return;
      }
      if (match.webphone === false) return;
      try {
        const detail = await nvoipGetSipUser(account, match.id);
        if (detail.user.webphone !== true) return;
        if (!detail.etag) {
          await writeNvoipIntegrationLog({
            organizationId: account.organizationId,
            nvoipAccountId: account.id,
            level: "warn",
            eventType: "profile_ramal_webphone_release_failed",
            message: "panel_access_missing_etag",
            payload: { numbersip, userId: match.id },
          }).catch(() => {});
          return;
        }
        await nvoipSetUserPanelAccess(account, {
          userId: match.id,
          etag: detail.etag,
          status: "INACTIVE",
        });
      } catch (err) {
        await writeNvoipIntegrationLog({
          organizationId: account.organizationId,
          nvoipAccountId: account.id,
          level: "warn",
          eventType: "profile_ramal_webphone_release_failed",
          message: err instanceof Error ? err.message : "profile_ramal_webphone_release_failed",
          payload: { numbersip, userId: match.id },
        }).catch(() => {});
      }
    }),
  );
}

/**
 * Aponta os números que já tocam em ramais para os ramais salvos nos perfis
 * e libera o registro SIP do CRM.
 */
export async function routeNvoipDidsToProfileRamais(organizationId: string): Promise<{
  ramais: string[];
  updated: string[];
}> {
  const account = await prisma.nvoipAccount.findFirst({
    where: { organizationId, status: "CONNECTED" },
  });
  if (!account) return { ramais: [], updated: [] };

  const pabxMode = parseNvoipPabxMode(
    account.externalConfig != null &&
      typeof account.externalConfig === "object" &&
      !Array.isArray(account.externalConfig)
      ? (account.externalConfig as Record<string, unknown>).pabxMode
      : undefined,
  );
  if (pabxMode === "external_pabx_trunk") return { ramais: [], updated: [] };

  const ramais = await listProfileRamais(organizationId);
  const destination = buildProfileDidDestination(ramais);
  if (!destination) return { ramais: [], updated: [] };

  await releaseProfileRamaisFromPanelWebphone(account, ramais);

  let dids;
  try {
    dids = await nvoipListDids(account);
  } catch (err) {
    await writeNvoipIntegrationLog({
      organizationId,
      nvoipAccountId: account.id,
      level: "warn",
      eventType: "profile_ramal_did_list_failed",
      message: err instanceof Error ? err.message : "profile_ramal_did_list_failed",
    }).catch(() => {});
    return { ramais: destination.split(","), updated: [] };
  }

  const updated: string[] = [];
  for (const did of dids) {
    if (!shouldRouteDidToProfileRamais(did.destination)) continue;
    if (didDestinationMatches(did.destination, destination)) continue;
    try {
      await nvoipUpdateDid(account, { number: did.number, destination });
      updated.push(did.number);
    } catch (err) {
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "warn",
        eventType: "profile_ramal_did_update_failed",
        message: err instanceof Error ? err.message : "profile_ramal_did_update_failed",
        payload: { number: did.number },
      }).catch(() => {});
    }
  }

  if (updated.length > 0) {
    await writeNvoipIntegrationLog({
      organizationId,
      nvoipAccountId: account.id,
      level: "info",
      eventType: "profile_ramal_did_routed",
      message: `Números ${updated.join(", ")} → ${destination}`,
      payload: { numbers: updated, destination },
    }).catch(() => {});
  }

  return { ramais: destination.split(","), updated };
}
