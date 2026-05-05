import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";

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
        message: "Super admin: use Entrar na organização ou o painel /super",
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

  const id = request.user.organizationId;
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
