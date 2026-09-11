import { prisma } from "../db.js";
import type { JwtPayload } from "../middleware/auth.js";
import { resolveEffectiveRole } from "./organizationMemberships.js";
import { resolveUserOrganizationId } from "./tenantContext.js";

/** Admin do tenant: SUPER_ADMIN a impersonar org, ou ADMIN efectivo (membership + legado). */
export async function isUserTenantAdmin(user: JwtPayload): Promise<boolean> {
  if (user.role === "SUPER_ADMIN") {
    return !!user.actingOrganizationId?.trim();
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });

  const organizationId = await resolveUserOrganizationId(user);
  const effectiveRole = await resolveEffectiveRole({
    userId: user.id,
    organizationId,
    fallbackRole: dbUser?.role ?? user.role,
  });

  return effectiveRole === "ADMIN";
}
