import { FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@openconduit/shared";

export interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
  organizationId?: string | null;
  /** Super admin a agir no contexto de uma organização (impersonação de tenant). */
  actingOrganizationId?: string | null;
  /** Quando preenchido, o JWT representa um utilizador impersonado por um super admin (`id` = utilizador impersonado). */
  superAdminActorId?: string | null;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Unauthorized", message: "Invalid or expired token", statusCode: 401 });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authenticate(request, reply);
  if (reply.sent) return;
  const u = request.user;
  if (!u) return;
  if (u.role === "ADMIN") return;
  if (u.role === "SUPER_ADMIN" && u.actingOrganizationId) return;
  reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
}

export async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authenticate(request, reply);
  if (reply.sent) return;
  if (request.user?.role !== "SUPER_ADMIN") {
    reply.status(403).send({ error: "Forbidden", message: "Super admin access required", statusCode: 403 });
  }
}
