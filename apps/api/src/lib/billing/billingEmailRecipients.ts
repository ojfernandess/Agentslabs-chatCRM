import { prisma } from "../../db.js";

/** Email de faturação da org ou primeiro administrador (fallback). */
export async function resolveBillingEmail(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      billingEmail: true,
      users: {
        where: { role: "ADMIN" },
        select: { email: true },
        take: 1,
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!org) return null;
  if (org.billingEmail?.trim()) return org.billingEmail.trim();
  return org.users[0]?.email?.trim() ?? null;
}

export async function resolveBillingEmailWithOverride(
  organizationId: string,
  overrideEmail?: string | null,
): Promise<string | null> {
  const trimmed = overrideEmail?.trim();
  if (trimmed) return trimmed;
  return resolveBillingEmail(organizationId);
}
