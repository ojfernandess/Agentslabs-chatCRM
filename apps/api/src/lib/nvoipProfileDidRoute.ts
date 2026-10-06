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
function routeWarning(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  return raw.replace(/\s+/g, " ").trim().slice(0, 120) || fallback;
}

async function releaseProfileRamaisFromPanelWebphone(
  account: NvoipAccount,
  ramais: string[],
): Promise<string | null> {
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
    return routeWarning(err, "profile_ramal_webphone_release_failed");
  }

  const warnings = await Promise.all(
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
        return "profile_ramal_user_not_found";
      }
      if (match.webphone === false) return null;
      try {
        const detail = await nvoipGetSipUser(account, match.id);
        if (detail.user.webphone !== true) return null;
        if (!detail.etag) {
          await writeNvoipIntegrationLog({
            organizationId: account.organizationId,
            nvoipAccountId: account.id,
            level: "warn",
            eventType: "profile_ramal_webphone_release_failed",
            message: "panel_access_missing_etag",
            payload: { numbersip, userId: match.id },
          }).catch(() => {});
          return "panel_access_missing_etag";
        }
        await nvoipSetUserPanelAccess(account, {
          userId: match.id,
          etag: detail.etag,
          status: "INACTIVE",
        });
        return null;
      } catch (err) {
        await writeNvoipIntegrationLog({
          organizationId: account.organizationId,
          nvoipAccountId: account.id,
          level: "warn",
          eventType: "profile_ramal_webphone_release_failed",
          message: err instanceof Error ? err.message : "profile_ramal_webphone_release_failed",
          payload: { numbersip, userId: match.id },
        }).catch(() => {});
        return routeWarning(err, "profile_ramal_webphone_release_failed");
      }
    }),
  );
  return warnings.find((warning) => warning) ?? null;
}

/**
 * Aponta os números que já tocam em ramais para os ramais salvos nos perfis
 * e libera o registro SIP do CRM.
 */
export async function routeNvoipDidsToProfileRamais(organizationId: string): Promise<{
  ramais: string[];
  updated: string[];
  warning: string | null;
}> {
  const account = await prisma.nvoipAccount.findFirst({
    where: { organizationId, status: "CONNECTED" },
  });
  if (!account) return { ramais: [], updated: [], warning: "nvoip_account_not_connected" };

  const pabxMode = parseNvoipPabxMode(
    account.externalConfig != null &&
      typeof account.externalConfig === "object" &&
      !Array.isArray(account.externalConfig)
      ? (account.externalConfig as Record<string, unknown>).pabxMode
      : undefined,
  );
  if (pabxMode === "external_pabx_trunk") return { ramais: [], updated: [], warning: "external_pabx_trunk" };

  const ramais = await listProfileRamais(organizationId);
  const destination = buildProfileDidDestination(ramais);
  if (!destination) return { ramais: [], updated: [], warning: "no_profile_ramais" };

  const releaseWarning = await releaseProfileRamaisFromPanelWebphone(account, ramais);

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
    return {
      ramais: destination.split(","),
      updated: [],
      warning: releaseWarning ?? routeWarning(err, "profile_ramal_did_list_failed"),
    };
  }

  const updated: string[] = [];
  let eligible = 0;
  let updateFailed = false;
  for (const did of dids) {
    if (!shouldRouteDidToProfileRamais(did.destination)) continue;
    eligible += 1;
    if (didDestinationMatches(did.destination, destination)) continue;
    try {
      await nvoipUpdateDid(account, { number: did.number, destination });
      updated.push(did.number);
    } catch (err) {
      updateFailed = true;
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

  const warning =
    releaseWarning ??
    (updateFailed ? "did_update_failed" : eligible === 0 ? "did_destination_not_extension" : null);
  return { ramais: destination.split(","), updated, warning };
}
