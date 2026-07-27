import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireSuperAdmin } from "../middleware/auth.js";
import { getPublicOrigin } from "../config.js";
import { initMcpProviders } from "../lib/mcp/providers/index.js";
import { resolveMcpAuth } from "../lib/mcp/auth/resolveMcpAuth.js";
import { handleMcpHttpRequest } from "../lib/mcp/transport/McpSessionManager.js";
import {
  createMcpAccessToken,
  listMcpAccessTokensForSuperAdmin,
  revokeMcpAccessTokenById,
} from "../lib/mcp/auth/mcpTokenService.js";
import { prisma } from "../db.js";

const createTokenSchema = z.object({
  name: z.string().min(1).max(200),
  organizationId: z.string().uuid(),
  debugMode: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

async function mcpAuthOr401(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<import("../lib/mcp/types.js").McpAuthContext | null> {
  const auth = await resolveMcpAuth(request);
  if (!auth) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Super admin MCP access required (ocm_ token or SUPER_ADMIN JWT with organization-id)",
      statusCode: 401,
    });
    return null;
  }
  return auth;
}

/** Rotas MCP — exclusivas do painel super admin (/api/v1/super/mcp). */
export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  initMcpProviders();

  /** Streamable HTTP — POST (JSON-RPC) */
  app.post("/", async (request, reply) => {
    const auth = await mcpAuthOr401(request, reply);
    if (!auth) return;
    await handleMcpHttpRequest(request.raw, reply.raw, auth, request.body);
    reply.hijack();
  });

  /** Streamable HTTP — GET (SSE) */
  app.get("/", async (request, reply) => {
    const auth = await mcpAuthOr401(request, reply);
    if (!auth) return;
    await handleMcpHttpRequest(request.raw, reply.raw, auth);
    reply.hijack();
  });

  /** Streamable HTTP — DELETE (session termination) */
  app.delete("/", async (request, reply) => {
    const auth = await mcpAuthOr401(request, reply);
    if (!auth) return;
    await handleMcpHttpRequest(request.raw, reply.raw, auth);
    reply.hijack();
  });

  /** Super admin: criar token MCP para inspecionar um tenant */
  app.post("/tokens", { preHandler: [authenticate, requireSuperAdmin] }, async (request, reply) => {
    const body = createTokenSchema.parse(request.body ?? {});

    const org = await prisma.organization.findUnique({
      where: { id: body.organizationId },
      select: { id: true, isActive: true },
    });
    if (!org?.isActive) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }

    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86400000)
      : null;

    const { token, id, prefix } = await createMcpAccessToken({
      organizationId: body.organizationId,
      userId: request.user!.id,
      name: body.name,
      role: "admin",
      debugMode: body.debugMode ?? true,
      expiresAt,
    });

    return reply.status(201).send({
      data: {
        id,
        token,
        prefix,
        organizationId: body.organizationId,
        endpoint: `${getPublicOrigin()}/api/v1/super/mcp`,
        message: "Store this token securely — it will not be shown again.",
      },
    });
  });

  /** Super admin: listar todos os tokens MCP da plataforma */
  app.get("/tokens", { preHandler: [authenticate, requireSuperAdmin] }, async () => {
    const tokens = await listMcpAccessTokensForSuperAdmin();
    return {
      data: tokens,
      endpoint: `${getPublicOrigin()}/api/v1/super/mcp`,
    };
  });

  /** Super admin: revogar token MCP */
  app.delete("/tokens/:id", { preHandler: [authenticate, requireSuperAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await revokeMcpAccessTokenById(id);
    if (!ok) {
      return reply.status(404).send({ error: "Not Found", message: "Token not found", statusCode: 404 });
    }
    return { data: { revoked: true } };
  });

  /** Metadados (requer super admin autenticado) */
  app.get("/info", { preHandler: [authenticate, requireSuperAdmin] }, async () => ({
    name: "opennexo-mcp-server",
    version: "1.0.0",
    protocol: "model-context-protocol",
    transport: "streamable-http",
    endpoint: `${getPublicOrigin()}/api/v1/super/mcp`,
    access: "SUPER_ADMIN only",
    auth: ["Bearer ocm_* (super admin panel)", "Bearer JWT (SUPER_ADMIN + organization-id header)"],
    documentation: "https://modelcontextprotocol.io/",
  }));
}
