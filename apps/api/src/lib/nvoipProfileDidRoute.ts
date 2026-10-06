import type { NvoipAccount } from "@prisma/client";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import { nvoipListDids, nvoipUpdateDid, nvoipUpdateSipUser } from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";
import { parseNvoipPabxMode } from "./nvoipPabxConfig.js";
import {
  buildProfileDidDestination,
  didDestinationMatches,
  shouldRouteDidToProfileRamais,
} from "./nvoipProfileRamais.js";

type ProfileRamal = { numbersip: string; sipPassword: string };

async function listProfileRamais(organizationId: string): Promise<ProfileRamal[]> {
  const rows = await prisma.userSipCredentials.findMany({
    where: {
      user: {
        OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
      },
    },
    select: { sipUser: true, sipPasswordEnc: true },
  });

  const byRamal = new Map<string, ProfileRamal>();
  for (const row of rows) {
    const numbersip = row.sipUser.replace(/\D/g, "");
    if (numbersip.length < 3 || numbersip.length > 16 || byRamal.has(numbersip)) continue;
    let sipPassword = "";
    try {
      sipPassword = decrypt(row.sipPasswordEnc)?.trim() ?? "";
    } catch {
      sipPassword = "";
    }
    byRamal.set(numbersip, { numbersip, sipPassword });
  }
  return [...byRamal.values()].sort((a, b) => a.numbersip.localeCompare(b.numbersip));
}

/** Tira o webphone do painel Nvoip do caminho para o INVITE cair no softphone do CRM. */
async function releaseProfileRamaisFromPanelWebphone(
  account: NvoipAccount,
  ramais: ProfileRamal[],
): Promise<void> {
  await Promise.all(
    ramais.map(async (ramal) => {
      try {
        await nvoipUpdateSipUser(account, {
          numbersip: ramal.numbersip,
          ...(ramal.sipPassword ? { sipPassword: ramal.sipPassword } : {}),
          webphone: false,
        });
      } catch (err) {
        await writeNvoipIntegrationLog({
          organizationId: account.organizationId,
          nvoipAccountId: account.id,
          level: "warn",
          eventType: "profile_ramal_webphone_release_failed",
          message: err instanceof Error ? err.message : "profile_ramal_webphone_release_failed",
          payload: { numbersip: ramal.numbersip },
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
  const destination = buildProfileDidDestination(ramais.map((ramal) => ramal.numbersip));
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
