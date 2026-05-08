import { FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@openconduit/shared";
import { authenticateAgentBot } from "./agentBotAuth.js";

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

export function bearerRawToken(request: FastifyRequest): string | null {
  const h = request.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * GET /api/v1/bots e GET /api/v1/bots/:id: aceita JWT de sessão (admin) ou Bearer `ocb_...` do bot
 * (apenas leitura do próprio registo — compatível com integradores que só têm um campo "token").
 */
export async function authenticateSessionOrBotInboxForBotsRead(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const raw = bearerRawToken(request);
  if (raw?.startsWith("ocb_")) {
    await authenticateAgentBot(request, reply);
    return;
  }
  await authenticate(request, reply);
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const raw = bearerRawToken(request);
  try {
    await request.jwtVerify();
  } catch {
    if (raw?.startsWith("ocb_")) {
      return reply.status(401).send({
        error: "Unauthorized",
        statusCode: 401,
        code: "AGENT_BOT_TOKEN_NOT_ALLOWED",
        message:
          "This route expects a user session JWT from POST /api/v1/auth/login. The Agent Bot token (ocb_...) works for read-only GET /api/v1/bots and GET /api/v1/bots/:id (own bot only), /api/v1/agent-bot/*, but not for POST/PATCH/DELETE on /api/v1/bots.",
        messagePt:
          "Esta rota exige JWT de POST /api/v1/auth/login. O token ocb_ do bot funciona em GET /api/v1/bots e GET /api/v1/bots/:id (só o próprio bot, leitura), em /api/v1/agent-bot/*, mas não em POST/PATCH/DELETE em /api/v1/bots.",
      });
    }
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
