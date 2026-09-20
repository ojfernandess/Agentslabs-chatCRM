import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { availabilityToClient, resolveEffectiveAvailability } from "./userAvailability.js";
import { getActivePresenceUserIds } from "./presenceService.js";
import { listMemberUserIds, organizationMembersWhere } from "./organizationMemberships.js";

export type AssignableUserRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Intent escolhido pelo atendente (persistido). */
  availabilityStatus: "online" | "away" | "offline";
  /** Presença activa com heartbeat recente. */
  presenceConnected: boolean;
  /** Estado visual / elegibilidade para transferência. */
  effectiveAvailabilityStatus: "online" | "away" | "offline";
  availabilityUpdatedAt: string | null;
  openConversationCount: number;
};

export async function listAssignableUsers(organizationId: string): Promise<AssignableUserRow[]> {
  const memberIds = await listMemberUserIds(organizationId);
  const where: Prisma.UserWhereInput =
    memberIds.length > 0
      ? { id: { in: memberIds } }
      : organizationMembersWhere(organizationId);

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      availabilityStatus: true,
      availabilityUpdatedAt: true,
    },
    orderBy: { name: "asc" },
  });

  const countMap = await openConversationCountByUserId(organizationId, users.map((u) => u.id));
  const presentIds = await getActivePresenceUserIds(
    organizationId,
    users.map((u) => u.id),
  );

  return users.map((row) => {
    const intent = availabilityToClient(row.availabilityStatus);
    const presenceConnected = presentIds.has(row.id);
    const effectiveAvailabilityStatus = resolveEffectiveAvailability(
      row.availabilityStatus,
      presenceConnected,
    );
    return {
      id: row.id,
      name: row.name,
      avatarUrl: row.avatarUrl,
      availabilityStatus: intent,
      presenceConnected,
      effectiveAvailabilityStatus,
      availabilityUpdatedAt: row.availabilityUpdatedAt?.toISOString() ?? null,
      openConversationCount: countMap.get(row.id) ?? 0,
    };
  });
}

/** Conversas abertas atribuídas ao atendente **neste tenant** (não global / outras orgs). */
export function openConversationCountWhere(
  organizationId: string,
  userIds: string[],
): Prisma.ConversationWhereInput {
  return {
    organizationId,
    assignedToId: { in: userIds },
    status: "OPEN",
    deletedAt: null,
    inbox: { organizationId },
  };
}

export async function openConversationCountByUserId(
  organizationId: string,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.conversation.groupBy({
    by: ["assignedToId"],
    where: openConversationCountWhere(organizationId, userIds),
    _count: { id: true },
  });

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.assignedToId) map.set(row.assignedToId, row._count.id);
  }
  return map;
}

export function enrichUsersWithOpenCounts<T extends { id: string }>(
  users: T[],
  countMap: Map<string, number>,
): (T & { openConversationCount: number })[] {
  return users.map((user) => ({
    ...user,
    openConversationCount: countMap.get(user.id) ?? 0,
  }));
}
