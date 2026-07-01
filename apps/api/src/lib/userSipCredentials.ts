import { prisma } from "../db.js";
import { encrypt, decrypt } from "./encryption.js";
import { formatNvoipCaller, findNvoipSipUserForCaller, nvoipSameNumbersip } from "./nvoipCallFormat.js";
import { nvoipUpdateSipUser } from "./nvoipClient.js";
import { syncNvoipSipUsers } from "./nvoipDirectorySync.js";
import { parseNvoipPabxMode } from "./nvoipPabxConfig.js";
import {
  nvoipEmbeddedSipDomain,
  nvoipEmbeddedSipWssUrl,
  nvoipEmbeddedSipWssAlternates,
  type NvoipEmbeddedSipClientConfig,
} from "./nvoipEmbeddedSipConfig.js";

export type UserSipCredentialsClient = NvoipEmbeddedSipClientConfig;

export { nvoipEmbeddedSipWssUrl as nvoipSipWssUrl };

export async function getUserSipCredentialsForClient(
  userId: string,
): Promise<UserSipCredentialsClient | null> {
  const row = await prisma.userSipCredentials.findUnique({
    where: { userId },
    select: { sipUser: true, sipPasswordEnc: true, displayName: true },
  });
  if (!row) return null;
  const sipPassword = decrypt(row.sipPasswordEnc);
  if (!sipPassword?.trim()) return null;
  return {
    sipUser: row.sipUser.trim(),
    sipPassword,
    displayName: row.displayName?.trim() || null,
    sipDomain: nvoipEmbeddedSipDomain(),
    wssUrl: nvoipEmbeddedSipWssUrl(),
    wssUrlAlternates: nvoipEmbeddedSipWssAlternates(),
  };
}

/** Desactiva webphone no painel Nvoip para o ramal — evita tocar no webphone externo em paralelo. */
async function disableNvoipPanelWebphoneForEmbeddedSip(
  organizationId: string,
  sipUser: string,
  sipPassword: string,
): Promise<void> {
  const account = await prisma.nvoipAccount.findFirst({
    where: { organizationId, status: "CONNECTED" },
  });
  if (!account) return;

  const pabxMode = parseNvoipPabxMode(
    account.externalConfig != null &&
      typeof account.externalConfig === "object" &&
      !Array.isArray(account.externalConfig)
      ? (account.externalConfig as Record<string, unknown>).pabxMode
      : undefined,
  );
  if (pabxMode === "external_pabx_trunk") return;

  const sipUsers = await prisma.nvoipSipUser.findMany({
    where: { nvoipAccountId: account.id, blocked: false },
    select: { numbersip: true, caller: true, webphone: true },
  });
  const matched = findNvoipSipUserForCaller(sipUser, sipUsers);
  if (!matched?.numbersip) return;
  if (matched.webphone === false) return;

  try {
    await nvoipUpdateSipUser(account, {
      numbersip: matched.numbersip,
      caller: matched.caller ?? undefined,
      sipPassword,
      webphone: false,
    });
    await syncNvoipSipUsers(account);
  } catch {
    /* best-effort — CRM softphone still works if Nvoip API sync fails */
  }
}

export async function upsertUserSipCredentials(input: {
  userId: string;
  organizationId?: string;
  sipUser: string;
  sipPassword: string;
  displayName?: string | null;
}): Promise<void> {
  const sipUser = input.sipUser.trim();
  const sipPassword = input.sipPassword.trim();
  if (!sipUser || !sipPassword) {
    throw new Error("sip_credentials_invalid");
  }

  if (input.organizationId) {
    const account = await prisma.nvoipAccount.findFirst({
      where: { organizationId: input.organizationId, status: "CONNECTED" },
      select: { numbersip: true },
    });
    if (account?.numbersip && nvoipSameNumbersip(sipUser, account.numbersip)) {
      throw new Error("sip_trunk_use_click_to_call");
    }
  }

  await prisma.userSipCredentials.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      sipUser,
      sipPasswordEnc: encrypt(sipPassword),
      displayName: input.displayName?.trim() || null,
    },
    update: {
      sipUser,
      sipPasswordEnc: encrypt(sipPassword),
      displayName: input.displayName?.trim() || null,
    },
  });

  if (input.organizationId) {
    await disableNvoipPanelWebphoneForEmbeddedSip(input.organizationId, sipUser, sipPassword);
  }
}

/** Caller POST /calls/ a partir das credenciais SIP embutidas (sem fallback para webphone do painel). */
export function resolveEmbeddedSipOutboundCaller(sipUser: string): string | null {
  const caller = formatNvoipCaller(sipUser);
  return caller.length >= 2 ? caller : null;
}
