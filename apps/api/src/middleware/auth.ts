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

function bearerRawToken(request: FastifyRequest): string | null {
  const h = request.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const raw = bearerRawToken(request);
  /** Integradores às vezes usam o token do bot (`ocb_`) nas rotas tenant; mensagem explícita (padrão Chatwoot: API token ≠ user session). */
  if (raw?.startsWith("ocb_")) {
    return reply.status(401).send({
      error: "Unauthorized",
      statusCode: 401,
      code: "AGENT_BOT_TOKEN_NOT_ALLOWED",
      message:
        "This route expects a user session JWT from POST /api/v1/auth/login (ADMIN or SUPER_ADMIN with tenant context). The Agent Bot inbox token (Bearer ocb_...) is only valid for /api/v1/agent-bot/* — e.g. GET /api/v1/agent-bot/profile, POST /api/v1/agent-bot/messages, PATCH /api/v1/agent-bot/conversations/:id.",
      messagePt:
        "Esta rota exige o JWT de sessão de utilizador obtido em POST /api/v1/auth/login (ADMIN ou SUPER_ADMIN no contexto do tenant). O token de inbox do bot (Bearer ocb_...) só é aceite em /api/v1/agent-bot/* — por exemplo GET /api/v1/agent-bot/profile, POST /api/v1/agent-bot/messages ou PATCH /api/v1/agent-bot/conversations/:id.",
    });
  }
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
