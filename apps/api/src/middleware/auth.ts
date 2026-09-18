import { FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@openconduit/shared";
import { authenticateAgentBot } from "./agentBotAuth.js";
import { authenticateUserApiToken } from "./userApiTokenAuth.js";
import { isUserTenantAdmin } from "../lib/tenantAdmin.js";

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

/** GET /contacts/:id/profile-picture — <img> não envia Authorization; aceita ?access_token=JWT. */
function isContactProfilePicturePath(url: string): boolean {
  return /\/contacts\/[^/]+\/profile-picture$/i.test(url.split("?")[0] ?? "");
}

function sessionTokenFromProfilePictureQuery(request: FastifyRequest): string | null {
  if (!isContactProfilePicturePath(request.url)) return null;
  const q = request.query as { access_token?: string };
  const raw = typeof q?.access_token === "string" ? q.access_token.trim() : "";
  return raw.length > 0 ? raw : null;
}

function ensureBearerForJwtVerify(request: FastifyRequest): void {
  if (bearerRawToken(request)) return;
  const fromQuery = sessionTokenFromProfilePictureQuery(request);
  if (fromQuery) {
    request.headers.authorization = `Bearer ${fromQuery}`;
  }
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
  ensureBearerForJwtVerify(request);
  const raw = bearerRawToken(request);
  try {
    await request.jwtVerify();
    return;
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
    if (raw?.startsWith("ocu_")) {
      return reply.status(401).send({
        error: "Unauthorized",
        statusCode: 401,
        code: "PROFILE_API_TOKEN_NOT_ALLOWED",
        message:
          "This route requires a session JWT from POST /api/v1/auth/login. Use the profile API token (ocu_) via Authorization: Bearer ocu_... or header api_access_token on application API routes (e.g. GET /api/v1/templates, POST /api/v1/messages).",
        messagePt:
          "Esta rota exige JWT de POST /api/v1/auth/login. Use o token de perfil (ocu_) com Authorization: Bearer ocu_... ou cabeçalho api_access_token nas rotas de API pública (ex.: GET /api/v1/templates, POST /api/v1/messages).",
      });
    }
    return reply.status(401).send({ error: "Unauthorized", message: "Invalid or expired token", statusCode: 401 });
  }
}

/** Application APIs (Chatwoot-like): accepts session JWT OR profile `api_access_token` / `Bearer ocu_...`. */
export async function authenticateSessionOrUserApiTokenForApplicationApis(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
    return;
  } catch {
    const apiTokenUser = await authenticateUserApiToken(request, reply);
    if (reply.sent) return;
    if (apiTokenUser) {
      request.user = apiTokenUser;
      return;
    }
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Invalid or missing JWT/api_access_token",
      statusCode: 401,
    });
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

  if (await isUserTenantAdmin(u)) return;

  reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
}

/** Admin check for application APIs authenticated with JWT or profile `ocu_` token. */
export async function requireAdminSessionOrUserApiTokenForApplicationApis(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user?.id) {
    await authenticateSessionOrUserApiTokenForApplicationApis(request, reply);
    if (reply.sent) return;
  }
  const u = request.user;
  if (!u) return;

  if (await isUserTenantAdmin(u)) return;

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
