import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import type { JwtPayload } from "../middleware/auth.js";

/**
 * Resolve a organização activa do utilizador (JWT + fallback membership).
 */
export async function resolveUserOrganizationId(user: JwtPayload): Promise<string | null> {
  if (user.role === "SUPER_ADMIN") {
    return user.actingOrganizationId?.trim() || null;
  }
  if (user.organizationId?.trim()) {
    return user.organizationId;
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/**
 * Tenant efectivo: organizationId (ADMIN/AGENT) ou actingOrganizationId (SUPER_ADMIN a impersonar).
 */
export async function resolveTenantOrganizationId(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | undefined> {
  if (request.user.role === "SUPER_ADMIN") {
    const acting = request.user.actingOrganizationId;
    if (!acting) {
      reply.status(403).send({
        error: "Forbidden",
        message:
          "Super admin: entre na organização no painel ou envie o UUID do tenant em cada pedido. Integração com token ocu_: cabeçalho organization_id, OpenConduit-Organization-Id, Organization-Id, ou query ?organizationId=<uuid> (vários nomes aceites — ver documentação).",
        statusCode: 403,
      });
      return undefined;
    }
    const org = await prisma.organization.findUnique({
      where: { id: acting },
      select: { isActive: true },
    });
    if (!org?.isActive) {
      reply.status(403).send({
        error: "Forbidden",
        message: "Esta organização está suspensa",
        statusCode: 403,
      });
      return undefined;
    }
    return acting;
  }

  const id = await resolveUserOrganizationId(request.user);
  if (!id) {
    reply.status(403).send({
      error: "Forbidden",
      message: "Utilizador sem organização associada",
      statusCode: 403,
    });
    return undefined;
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { isActive: true },
  });
  if (!org?.isActive) {
    reply.status(403).send({
      error: "Forbidden",
      message: "Esta organização está suspensa",
      statusCode: 403,
    });
    return undefined;
  }
  return id;
}
