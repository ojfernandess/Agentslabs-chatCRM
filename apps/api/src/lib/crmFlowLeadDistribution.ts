import { prisma } from "../db.js";
import { pickAutoAssigneeForInbox } from "./inboxAutoAssignment.js";

export type DistributeMethod = "round_robin" | "least_load" | "by_region" | "by_interest";

function extractDdd(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits.slice(2, 4);
  if (digits.length >= 10) return digits.slice(0, 2);
  return null;
}

/** Round-robin por organização usando contagem de deals atribuídos. */
async function pickRoundRobinUser(organizationId: string, userIds: string[]): Promise<string | null> {
  if (userIds.length === 0) return null;
  const counts = await prisma.deal.groupBy({
    by: ["ownerId"],
    where: { organizationId, ownerId: { in: userIds }, status: "OPEN" },
    _count: { id: true },
  });
  const load = new Map<string, number>();
  for (const uid of userIds) load.set(uid, 0);
  for (const row of counts) {
    if (row.ownerId) load.set(row.ownerId, row._count.id);
  }
  let best: string | null = null;
  let bestLoad = Number.POSITIVE_INFINITY;
  for (const uid of userIds) {
    const n = load.get(uid) ?? 0;
    if (n < bestLoad) {
      bestLoad = n;
      best = uid;
    }
  }
  return best;
}

async function pickLeastLoadUser(organizationId: string, userIds: string[]): Promise<string | null> {
  if (userIds.length === 0) return null;
  const counts = await prisma.deal.groupBy({
    by: ["ownerId"],
    where: { organizationId, ownerId: { in: userIds }, status: "OPEN" },
    _count: { id: true },
  });
  const load = new Map<string, number>();
  for (const uid of userIds) load.set(uid, 0);
  for (const row of counts) {
    if (row.ownerId) load.set(row.ownerId, row._count.id);
  }
  let best: string | null = null;
  let bestLoad = Number.POSITIVE_INFINITY;
  for (const uid of userIds) {
    const n = load.get(uid) ?? 0;
    if (n < bestLoad) {
      bestLoad = n;
      best = uid;
    }
  }
  return best;
}

function pickByRegionMapping(
  ddd: string | null,
  mappings: { ddd: string; userId: string }[],
  fallbackUserIds: string[],
): string | null {
  if (ddd) {
    const hit = mappings.find((m) => m.ddd === ddd);
    if (hit?.userId) return hit.userId;
  }
  return fallbackUserIds[0] ?? null;
}

function pickByInterestMapping(
  interest: string,
  mappings: { interest: string; userId: string }[],
  fallbackUserIds: string[],
): string | null {
  const norm = interest.toLowerCase();
  const hit = mappings.find((m) => norm.includes(m.interest.toLowerCase()));
  return hit?.userId ?? fallbackUserIds[0] ?? null;
}

export async function distributeLeadToUser(params: {
  organizationId: string;
  contactId: string;
  method: DistributeMethod;
  inboxId?: string;
  phone?: string;
  interestText?: string;
  regionMappings?: { ddd: string; userId: string }[];
  interestMappings?: { interest: string; userId: string }[];
  candidateUserIds?: string[];
}): Promise<string | null> {
  const {
    organizationId,
    contactId,
    method,
    inboxId,
    phone,
    interestText,
    regionMappings = [],
    interestMappings = [],
    candidateUserIds,
  } = params;

  let userIds = candidateUserIds ?? [];
  if (userIds.length === 0) {
    const users = await prisma.user.findMany({
      where: { organizationId, role: { in: ["ADMIN", "AGENT"] } },
      select: { id: true },
    });
    userIds = users.map((u) => u.id);
  }

  if (userIds.length === 0) return null;

  let picked: string | null = null;
  switch (method) {
    case "round_robin":
      picked = await pickRoundRobinUser(organizationId, userIds);
      break;
    case "least_load":
      picked = await pickLeastLoadUser(organizationId, userIds);
      break;
    case "by_region":
      picked = pickByRegionMapping(extractDdd(phone), regionMappings, userIds);
      break;
    case "by_interest":
      picked = pickByInterestMapping(interestText ?? "", interestMappings, userIds);
      break;
    default:
      picked = userIds[0] ?? null;
  }

  if (!picked && inboxId) {
    picked = await pickAutoAssigneeForInbox(inboxId, organizationId);
  }

  if (picked) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { assignedToId: picked },
    });
  }

  return picked;
}
