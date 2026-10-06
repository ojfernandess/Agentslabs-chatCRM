import { prisma } from "../db.js";
import { encrypt, decrypt } from "./encryption.js";
import { formatNvoipCaller, nvoipSameNumbersip } from "./nvoipCallFormat.js";
import { routeNvoipDidsToProfileRamais } from "./nvoipProfileDidRoute.js";
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
    await routeNvoipDidsToProfileRamais(input.organizationId).catch(() => {});
  }
}

/** Caller POST /calls/ a partir das credenciais SIP embutidas (sem fallback para webphone do painel). */
export function resolveEmbeddedSipOutboundCaller(sipUser: string): string | null {
  const caller = formatNvoipCaller(sipUser);
  return caller.length >= 2 ? caller : null;
}
