import { prisma } from "../db.js";
import { resolveNvoipCallerForSipUser, sanitizeNvoipOutboundCaller } from "./nvoipCallFormat.js";

export type NvoipTrunkRow = {
  id: string;
  name: string;
  defaultCaller: string;
  isDefault: boolean;
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

/** Caller for POST /calls/ — synced SIP user / account NumberSIP (PABX trunk) or ramal. */
export async function resolveNvoipOutboundCaller(input: {
  organizationId: string;
  accountId: string;
  userId: string;
  accountDefaultCaller: string;
  trunkId?: string | null;
}): Promise<string> {
  const account = await prisma.nvoipAccount.findUnique({
    where: { id: input.accountId },
    select: { numbersip: true },
  });
  const accountNumbersip = account?.numbersip ?? "";

  const sipUsers = await prisma.nvoipSipUser.findMany({
    where: { nvoipAccountId: input.accountId, blocked: false },
    select: { numbersip: true, caller: true },
    orderBy: [{ name: "asc" }, { numbersip: "asc" }],
  });

  const pick = (raw: string | null | undefined): string | null =>
    sanitizeNvoipOutboundCaller(raw, accountNumbersip, sipUsers);

  if (input.trunkId?.trim()) {
    const trunk = await prisma.nvoipTrunk.findFirst({
      where: { id: input.trunkId.trim(), organizationId: input.organizationId },
      select: { defaultCaller: true },
    });
    const fromTrunk = pick(trunk?.defaultCaller);
    if (fromTrunk) return fromTrunk;
  }

  const ext = await prisma.nvoipAgentExtension.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    select: { caller: true, nvoipNumbersip: true },
  });

  if (ext?.nvoipNumbersip?.trim()) {
    const sip = sipUsers.find((s) => s.numbersip === ext.nvoipNumbersip!.trim());
    if (sip) {
      const fromSip = pick(resolveNvoipCallerForSipUser(sip));
      if (fromSip) return fromSip;
    }
  }

  const fromExt = pick(ext?.caller);
  if (fromExt) return fromExt;

  const fromAccount = pick(input.accountDefaultCaller);
  if (fromAccount) return fromAccount;

  const defaultTrunk = await prisma.nvoipTrunk.findFirst({
    where: { organizationId: input.organizationId, isDefault: true },
    select: { defaultCaller: true },
  });
  const fromDefaultTrunk = pick(defaultTrunk?.defaultCaller);
  if (fromDefaultTrunk) return fromDefaultTrunk;

  for (const sip of sipUsers) {
    const fromSip = pick(resolveNvoipCallerForSipUser(sip));
    if (fromSip) return fromSip;
  }

  return "";
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
        select: { numbersip: true, caller: true },
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
