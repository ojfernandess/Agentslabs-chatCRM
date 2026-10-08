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
import { getOrgSipServer, type OrgSipRingtone } from "./orgSipServer.js";

export type UserSipCredentialsClient = NvoipEmbeddedSipClientConfig & {
  /** nvoip mantém o servidor da conta. sip usa o domínio/WSS configurado na organização. */
  sipProvider: "nvoip" | "sip";
  ringTone: OrgSipRingtone;
  callDistribution: boolean;
};

export async function resolveOrganizationSipEndpoint(organizationId: string): Promise<{
  sipProvider: "nvoip" | "sip";
  sipDomain: string;
  wssUrl: string;
  wssUrlAlternates: string[];
  ringTone: OrgSipRingtone;
  callDistribution: boolean;
}> {
  const custom = await getOrgSipServer(organizationId);
  const account = await prisma.nvoipAccount.findFirst({
    where: { organizationId, status: "CONNECTED" },
    select: { id: true },
  });
  const nvoipDomain = nvoipEmbeddedSipDomain();
  const nvoipWss = nvoipEmbeddedSipWssUrl();
  const customIsNvoipDefault =
    !!custom && custom.sipDomain === nvoipDomain && custom.wssUrl.replace(/\/+$/, "") === nvoipWss.replace(/\/+$/, "");
  const ringTone = custom?.ringTone ?? "classic";
  const callDistribution = custom?.callDistribution === true;
  if (account && (!custom || customIsNvoipDefault)) {
    return {
      sipProvider: "nvoip",
      sipDomain: nvoipDomain,
      wssUrl: nvoipWss,
      wssUrlAlternates: nvoipEmbeddedSipWssAlternates(),
      ringTone,
      callDistribution,
    };
  }
  return {
    sipProvider: "sip",
    sipDomain: custom?.sipDomain ?? "",
    wssUrl: custom?.wssUrl ?? "",
    wssUrlAlternates: [],
    ringTone,
    callDistribution,
  };
}

export { nvoipEmbeddedSipWssUrl as nvoipSipWssUrl };

export async function getUserSipCredentialsForClient(
  userId: string,
  organizationId?: string,
): Promise<UserSipCredentialsClient | null> {
  const row = await prisma.userSipCredentials.findUnique({
    where: { userId },
    select: { sipUser: true, sipPasswordEnc: true, displayName: true },
  });
  if (!row) return null;
  const sipPassword = decrypt(row.sipPasswordEnc);
  if (!sipPassword?.trim()) return null;
  const endpoint = organizationId
    ? await resolveOrganizationSipEndpoint(organizationId)
    : {
        sipProvider: "nvoip" as const,
        sipDomain: nvoipEmbeddedSipDomain(),
        wssUrl: nvoipEmbeddedSipWssUrl(),
        wssUrlAlternates: nvoipEmbeddedSipWssAlternates(),
        ringTone: "classic" as const,
        callDistribution: false,
      };
  return {
    sipUser: row.sipUser.trim(),
    sipPassword,
    displayName: row.displayName?.trim() || null,
    sipDomain: endpoint.sipDomain,
    wssUrl: endpoint.wssUrl,
    wssUrlAlternates: endpoint.wssUrlAlternates,
    sipProvider: endpoint.sipProvider,
    ringTone: endpoint.ringTone,
    callDistribution: endpoint.callDistribution,
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
