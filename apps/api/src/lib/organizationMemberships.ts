import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../db.js";

/** Papéis de membership de tenant (não SUPER_ADMIN). */
export type OrgMemberRole = "ADMIN" | "AGENT";

export function isOrgMemberRole(role: UserRole | string | null | undefined): role is OrgMemberRole {
  return role === "ADMIN" || role === "AGENT";
}

export async function getMembership(organizationId: string, userId: string) {
  return prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
}

export async function listMembershipsForUser(userId: string) {
  return prisma.organizationMembership.findMany({
    where: { userId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          settings: { select: { organizationLogoUrl: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function ensureMembership(
  params: {
    organizationId: string;
    userId: string;
    role: OrgMemberRole;
  },
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  return db.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: params.organizationId,
        userId: params.userId,
      },
    },
    create: {
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role,
    },
    update: {
      role: params.role,
    },
  });
}

/** Utilizadores com membership nesta org (para listagens / assignable). */
export async function listMemberUserIds(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Tamanho da equipe (Configurações → Equipe / limite `users` em billing).
 * Prefer membership rows; fallback legado a `users.organization_id` (pré-backfill).
 */
export async function countOrganizationTeamMembers(organizationId: string): Promise<number> {
  const membershipCount = await prisma.organizationMembership.count({
    where: { organizationId },
  });
  if (membershipCount > 0) return membershipCount;

  return prisma.user.count({
    where: {
      organizationId,
      role: { not: "SUPER_ADMIN" },
    },
  });
}

/**
 * Filtro Prisma: membros da org via membership, com fallback ao `users.organization_id` legado
 * (antes do backfill / linhas sem membership).
 */
export function organizationMembersWhere(organizationId: string): Prisma.UserWhereInput {
  return {
    OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
  };
}

/** Utilizador pertence ao tenant (membership ou `users.organization_id` legado). */
export async function userBelongsToOrganization(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const membership = await getMembership(organizationId, userId);
  if (membership) return true;
  const legacy = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  return legacy != null;
}

/**
 * Resolve papel efectivo no tenant activo.
 * ADMIN se membership ou users.role legado indicarem ADMIN (corrige dessincronia).
 */
export async function resolveEffectiveRole(params: {
  userId: string;
  organizationId: string | null;
  fallbackRole: UserRole;
}): Promise<UserRole> {
  if (params.fallbackRole === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (!params.organizationId) {
    return isOrgMemberRole(params.fallbackRole) ? params.fallbackRole : "AGENT";
  }

  const m = await getMembership(params.organizationId, params.userId);
  const membershipRole = m && isOrgMemberRole(m.role) ? m.role : null;
  const legacyRole = isOrgMemberRole(params.fallbackRole) ? params.fallbackRole : null;

  if (membershipRole === "ADMIN" || legacyRole === "ADMIN") return "ADMIN";
  if (membershipRole) return membershipRole;
  if (legacyRole) return legacyRole;
  return "AGENT";
}

/**
 * Define workspace activo (`users.organization_id` + `users.role`) a partir da membership.
 * Mantém JWT/sessão compatíveis com o modelo single-org anterior.
 */
/**
 * Sincroniza memberships de um utilizador (super admin / multi-org).
 * Define workspace activo e papel a partir de `activeOrganizationId`.
 */
export async function syncUserMemberships(
  userId: string,
  memberships: { organizationId: string; role: OrgMemberRole }[],
  activeOrganizationId: string | null,
  tx?: Prisma.TransactionClient,
): Promise<{ organizationId: string; role: OrgMemberRole }> {
  const unique = new Map<string, OrgMemberRole>();
  for (const m of memberships) {
    unique.set(m.organizationId, m.role);
  }
  const list = [...unique.entries()].map(([organizationId, role]) => ({ organizationId, role }));
  if (list.length === 0) {
    throw new Error("NO_MEMBERSHIPS");
  }

  const activeId =
    activeOrganizationId && unique.has(activeOrganizationId)
      ? activeOrganizationId
      : list[0]!.organizationId;
  const activeRole = unique.get(activeId)!;

  const run = async (db: Prisma.TransactionClient) => {
    const keepIds = list.map((m) => m.organizationId);
    await db.organizationMembership.deleteMany({
      where: { userId, organizationId: { notIn: keepIds } },
    });
    for (const m of list) {
      await ensureMembership({ organizationId: m.organizationId, userId, role: m.role }, db);
    }
    await db.user.update({
      where: { id: userId },
      data: { organizationId: activeId, role: activeRole },
    });
  };

  if (tx) {
    await run(tx);
  } else {
    await prisma.$transaction(run);
  }

  return { organizationId: activeId, role: activeRole };
}

export async function activateOrganizationForUser(params: {
  userId: string;
  organizationId: string;
  role?: OrgMemberRole;
}): Promise<{ organizationId: string; role: OrgMemberRole }> {
  const membership =
    params.role != null
      ? await ensureMembership({
          organizationId: params.organizationId,
          userId: params.userId,
          role: params.role,
        })
      : await getMembership(params.organizationId, params.userId);

  if (!membership || !isOrgMemberRole(membership.role)) {
    throw new Error("NOT_A_MEMBER");
  }

  await prisma.user.update({
    where: { id: params.userId },
    data: {
      organizationId: params.organizationId,
      role: membership.role,
    },
  });

  return { organizationId: params.organizationId, role: membership.role };
}
