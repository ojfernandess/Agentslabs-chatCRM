import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { parseNvoipPabxMode } from "./nvoipPabxConfig.js";
import {
  findNvoipSipUserForCaller,
  formatNvoipCaller,
  nvoipSameNumbersip,
  nvoipSipUserHasWebphone,
  resolveNvoipCallerForSipUser,
  sanitizeNvoipOutboundCaller,
} from "./nvoipCallFormat.js";
import { resolveEmbeddedSipOutboundCaller } from "./userSipCredentials.js";

export type NvoipTrunkRow = {
  id: string;
  name: string;
  defaultCaller: string;
  isDefault: boolean;
};

export type NvoipSipUserRow = {
  numbersip: string;
  caller: string | null;
  webphone: boolean | null;
};

export type NvoipCallerWarning = "pabx_trunk_not_webphone" | "no_webphone_users";

export type NvoipCallerResolution = {
  caller: string;
  source:
    | "agent_sip_webphone"
    | "agent_sip"
    | "agent_extension"
    | "trunk"
    | "webphone_fallback"
    | "account_default"
    | "default_trunk"
    | "sip_user"
    | "embedded_sip";
  sipUser: NvoipSipUserRow | null;
  hasWebphone: boolean;
  warning: NvoipCallerWarning | null;
};

export function trunkToClient(row: {
  id: string;
  name: string;
  defaultCaller: string;
  isDefault: boolean;
}): NvoipTrunkRow {
  return {
    id: row.id,
    name: row.name,
    defaultCaller: row.defaultCaller,
    isDefault: row.isDefault,
  };
}

export async function listNvoipTrunks(organizationId: string): Promise<NvoipTrunkRow[]> {
  const rows = await prisma.nvoipTrunk.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, defaultCaller: true, isDefault: true },
  });
  return rows.map(trunkToClient);
}

function buildResolution(
  caller: string,
  source: NvoipCallerResolution["source"],
  sipUsers: NvoipSipUserRow[],
  accountNumbersip: string,
  warning: NvoipCallerWarning | null = null,
): NvoipCallerResolution {
  const matched = findNvoipSipUserForCaller(caller, sipUsers);
  const sipUser = matched
    ? (sipUsers.find((s) => s.numbersip === matched.numbersip) ?? {
        numbersip: matched.numbersip,
        caller: matched.caller ?? null,
        webphone: matched.webphone ?? null,
      })
    : null;
  const hasWebphone = nvoipSipUserHasWebphone(sipUser);
  let resolvedWarning = warning;
  if (
    !resolvedWarning &&
    accountNumbersip &&
    nvoipSameNumbersip(caller, accountNumbersip) &&
    !hasWebphone
  ) {
    resolvedWarning = "pabx_trunk_not_webphone";
  }
  return { caller, source, sipUser, hasWebphone, warning: resolvedWarning };
}

function shouldPreferWebphoneFallback(input: {
  candidateCaller: string;
  accountNumbersip: string;
  sipUsers: NvoipSipUserRow[];
  webphoneSips: NvoipSipUserRow[];
  agentExplicitlyConfigured: boolean;
  preferWebphone: boolean;
}): boolean {
  if (!input.preferWebphone || input.agentExplicitlyConfigured || input.webphoneSips.length === 0) {
    return false;
  }
  const sip = findNvoipSipUserForCaller(input.candidateCaller, input.sipUsers);
  if (nvoipSipUserHasWebphone(sip)) return false;
  if (input.accountNumbersip && nvoipSameNumbersip(input.candidateCaller, input.accountNumbersip)) {
    return true;
  }
  return sip != null && !nvoipSipUserHasWebphone(sip);
}

function pickWebphoneFallback(
  webphoneSips: NvoipSipUserRow[],
  sipUsers: NvoipSipUserRow[],
  accountNumbersip: string,
  pick: (raw: string | null | undefined) => string | null,
): NvoipCallerResolution | null {
  for (const sip of webphoneSips) {
    const caller = pick(resolveNvoipCallerForSipUser(sip));
    if (caller) {
      return buildResolution(caller, "webphone_fallback", sipUsers, accountNumbersip, null);
    }
  }
  return null;
}

function resolveWithWebphoneAwareFallback(input: {
  caller: string;
  source: NvoipCallerResolution["source"];
  accountNumbersip: string;
  sipUsers: NvoipSipUserRow[];
  webphoneSips: NvoipSipUserRow[];
  agentExplicitlyConfigured: boolean;
  preferWebphone: boolean;
  pick: (raw: string | null | undefined) => string | null;
}): NvoipCallerResolution | null {
  if (
    shouldPreferWebphoneFallback({
      candidateCaller: input.caller,
      accountNumbersip: input.accountNumbersip,
      sipUsers: input.sipUsers,
      webphoneSips: input.webphoneSips,
      agentExplicitlyConfigured: input.agentExplicitlyConfigured,
      preferWebphone: input.preferWebphone,
    })
  ) {
    return pickWebphoneFallback(input.webphoneSips, input.sipUsers, input.accountNumbersip, input.pick);
  }
  return buildResolution(input.caller, input.source, input.sipUsers, input.accountNumbersip);
}

/** Caller for POST /calls/ — prefers webphone-enabled SIP users over PABX trunk NumberSIP. */
export async function resolveNvoipOutboundCallerDetailed(input: {
  organizationId: string;
  accountId: string;
  userId: string;
  accountDefaultCaller: string;
  trunkId?: string | null;
}): Promise<NvoipCallerResolution | null> {
  const account = await prisma.nvoipAccount.findUnique({
    where: { id: input.accountId },
    select: { numbersip: true, externalConfig: true },
  });
  const accountNumbersip = account?.numbersip ?? "";
  const pabxMode = parseNvoipPabxMode(
    account?.externalConfig != null &&
      typeof account.externalConfig === "object" &&
      !Array.isArray(account.externalConfig)
      ? (account.externalConfig as Record<string, unknown>).pabxMode
      : undefined,
  );
  const preferWebphone = pabxMode !== "external_pabx_trunk";

  const sipUsers = await prisma.nvoipSipUser.findMany({
    where: { nvoipAccountId: input.accountId, blocked: false },
    select: { numbersip: true, caller: true, webphone: true },
    orderBy: [{ webphone: "desc" }, { name: "asc" }, { numbersip: "asc" }],
  });
  const webphoneSips = sipUsers.filter((s) => s.webphone === true);

  const pick = (raw: string | null | undefined): string | null =>
    sanitizeNvoipOutboundCaller(raw, accountNumbersip, sipUsers);

  const embeddedSipEnabled = await isOrganizationFeatureEnabled(
    input.organizationId,
    "nvoip_embedded_sip",
  );
  if (embeddedSipEnabled && pabxMode !== "external_pabx_trunk") {
    const embedded = await prisma.userSipCredentials.findUnique({
      where: { userId: input.userId },
      select: { sipUser: true },
    });
    const fromEmbedded = embedded?.sipUser
      ? resolveEmbeddedSipOutboundCaller(embedded.sipUser)
      : null;
    if (fromEmbedded) {
      const matched = findNvoipSipUserForCaller(fromEmbedded, sipUsers);
      return {
        caller: fromEmbedded,
        source: "embedded_sip",
        sipUser: matched
          ? {
              numbersip: matched.numbersip,
              caller: matched.caller ?? null,
              webphone: matched.webphone ?? null,
            }
          : null,
        hasWebphone: true,
        warning: null,
      };
    }
  }

  /** PABX externo (MicroSIP/Asterisk): caller deve ser o NumberSIP trunk registado no softphone. */
  if (pabxMode === "external_pabx_trunk" && accountNumbersip) {
    const fromTrunk = pick(accountNumbersip);
    if (fromTrunk) {
      return buildResolution(fromTrunk, "account_default", sipUsers, accountNumbersip, null);
    }
  }

  const ext = await prisma.nvoipAgentExtension.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    select: { caller: true, nvoipNumbersip: true },
  });
  const agentExplicitlyConfigured = Boolean(
    ext?.nvoipNumbersip?.trim() || ext?.caller?.trim(),
  );

  if (input.trunkId?.trim()) {
    const trunk = await prisma.nvoipTrunk.findFirst({
      where: { id: input.trunkId.trim(), organizationId: input.organizationId },
      select: { defaultCaller: true },
    });
    const fromTrunk = pick(trunk?.defaultCaller);
    if (fromTrunk) {
      return resolveWithWebphoneAwareFallback({
        caller: fromTrunk,
        source: "trunk",
        accountNumbersip,
        sipUsers,
        webphoneSips,
        agentExplicitlyConfigured,
        preferWebphone,
        pick,
      });
    }
  }

  if (ext?.nvoipNumbersip?.trim()) {
    const sip = sipUsers.find((s) => s.numbersip === ext.nvoipNumbersip!.trim());
    if (sip) {
      const fromSip = pick(resolveNvoipCallerForSipUser(sip));
      if (fromSip) {
        return buildResolution(
          fromSip,
          sip.webphone ? "agent_sip_webphone" : "agent_sip",
          sipUsers,
          accountNumbersip,
        );
      }
    }
  }

  const fromExt = pick(ext?.caller);
  if (fromExt) {
    if (
      shouldPreferWebphoneFallback({
        candidateCaller: fromExt,
        accountNumbersip,
        sipUsers,
        webphoneSips,
        agentExplicitlyConfigured: false,
        preferWebphone,
      })
    ) {
      const fallback = pickWebphoneFallback(webphoneSips, sipUsers, accountNumbersip, pick);
      if (fallback) return fallback;
    }
    return buildResolution(fromExt, "agent_extension", sipUsers, accountNumbersip);
  }

  if (preferWebphone && !agentExplicitlyConfigured && webphoneSips.length > 0) {
    const fallback = pickWebphoneFallback(webphoneSips, sipUsers, accountNumbersip, pick);
    if (fallback) return fallback;
  }

  const fromAccount = pick(input.accountDefaultCaller);
  if (fromAccount) {
    return resolveWithWebphoneAwareFallback({
      caller: fromAccount,
      source: "account_default",
      accountNumbersip,
      sipUsers,
      webphoneSips,
      agentExplicitlyConfigured,
      preferWebphone,
      pick,
    });
  }

  const defaultTrunk = await prisma.nvoipTrunk.findFirst({
    where: { organizationId: input.organizationId, isDefault: true },
    select: { defaultCaller: true },
  });
  const fromDefaultTrunk = pick(defaultTrunk?.defaultCaller);
  if (fromDefaultTrunk) {
    return resolveWithWebphoneAwareFallback({
      caller: fromDefaultTrunk,
      source: "default_trunk",
      accountNumbersip,
      sipUsers,
      webphoneSips,
      agentExplicitlyConfigured,
      preferWebphone,
      pick,
    });
  }

  for (const sip of sipUsers) {
    const fromSip = pick(resolveNvoipCallerForSipUser(sip));
    if (fromSip) {
      return buildResolution(
        fromSip,
        sip.webphone ? "agent_sip_webphone" : "sip_user",
        sipUsers,
        accountNumbersip,
      );
    }
  }

  if (webphoneSips.length === 0 && accountNumbersip) {
    const fromPrimary = pick(accountNumbersip);
    if (fromPrimary) {
      return buildResolution(fromPrimary, "account_default", sipUsers, accountNumbersip, "no_webphone_users");
    }
  }

  return null;
}

export async function resolveNvoipOutboundCaller(input: {
  organizationId: string;
  accountId: string;
  userId: string;
  accountDefaultCaller: string;
  trunkId?: string | null;
}): Promise<string> {
  const resolved = await resolveNvoipOutboundCallerDetailed(input);
  return resolved?.caller ?? "";
}

export async function validateNvoipOutboundCallerForOrg(
  organizationId: string,
  caller: string,
  accountNumbersipOverride?: string,
  nvoipAccountIdOverride?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const account = await prisma.nvoipAccount.findUnique({
    where: { organizationId },
    select: { id: true, numbersip: true },
  });
  if (!account && !accountNumbersipOverride) {
    return { ok: false, message: "account_not_found" };
  }
  const accountId = nvoipAccountIdOverride ?? account?.id;
  const sipUsers = accountId
    ? await prisma.nvoipSipUser.findMany({
        where: { nvoipAccountId: accountId },
        select: { numbersip: true, caller: true, webphone: true },
      })
    : [];
  const valid = sanitizeNvoipOutboundCaller(
    caller,
    accountNumbersipOverride ?? account?.numbersip ?? "",
    sipUsers,
  );
  if (!valid) return { ok: false, message: "nvoip_invalid_caller_use_ramal" };
  return { ok: true };
}

export async function ensureSingleDefaultTrunk(
  organizationId: string,
  nvoipAccountId: string,
  trunkId: string,
): Promise<void> {
  await prisma.nvoipTrunk.updateMany({
    where: { organizationId, nvoipAccountId, id: { not: trunkId } },
    data: { isDefault: false },
  });
  await prisma.nvoipTrunk.update({
    where: { id: trunkId },
    data: { isDefault: true },
  });
}

export async function listNvoipWebphoneUsers(accountId: string): Promise<
  { numbersip: string; caller: string | null; name: string | null }[]
> {
  const rows = await prisma.nvoipSipUser.findMany({
    where: { nvoipAccountId: accountId, blocked: false, webphone: true },
    select: { numbersip: true, caller: true, name: true },
    orderBy: [{ name: "asc" }, { numbersip: "asc" }],
  });
  return rows;
}
