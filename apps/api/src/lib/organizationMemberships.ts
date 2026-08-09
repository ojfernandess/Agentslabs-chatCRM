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
 * Filtro Prisma: membros da org via membership, com fallback ao `users.organization_id` legado
 * (antes do backfill / linhas sem membership).
 */
export function organizationMembersWhere(organizationId: string): Prisma.UserWhereInput {
  return {
    OR: [{ organizationId }, { memberships: { some: { organizationId } } }],
  };
}

/**
 * Resolve papel efectivo no tenant activo.
 * Preferência: membership da org activa → role do user (legado) → AGENT.
 */
export async function resolveEffectiveRole(params: {
  userId: string;
  organizationId: string | null;
  fallbackRole: UserRole;
}): Promise<UserRole> {
  if (params.fallbackRole === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (!params.organizationId) return params.fallbackRole;
  const m = await getMembership(params.organizationId, params.userId);
  if (m && isOrgMemberRole(m.role)) return m.role;
  if (isOrgMemberRole(params.fallbackRole)) return params.fallbackRole;
  return "AGENT";
}

/**
 * Define workspace activo (`users.organization_id` + `users.role`) a partir da membership.
 * Mantém JWT/sessão compatíveis com o modelo single-org anterior.
 */
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
