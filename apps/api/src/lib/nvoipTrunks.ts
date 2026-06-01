import { prisma } from "../db.js";

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

export async function resolveNvoipOutboundCaller(input: {
  organizationId: string;
  accountId: string;
  userId: string;
  accountDefaultCaller: string;
  trunkId?: string | null;
}): Promise<string> {
  if (input.trunkId) {
    const trunk = await prisma.nvoipTrunk.findFirst({
      where: { id: input.trunkId, organizationId: input.organizationId },
      select: { defaultCaller: true },
    });
    if (trunk?.defaultCaller.trim()) return trunk.defaultCaller.trim().slice(0, 32);
  }

  const defaultTrunk = await prisma.nvoipTrunk.findFirst({
    where: { organizationId: input.organizationId, isDefault: true },
    select: { defaultCaller: true },
  });
  if (defaultTrunk?.defaultCaller.trim()) {
    return defaultTrunk.defaultCaller.trim().slice(0, 32);
  }

  const ext = await prisma.nvoipAgentExtension.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    select: { caller: true },
  });
  const caller = (ext?.caller ?? input.accountDefaultCaller).trim();
  return caller.slice(0, 32);
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
