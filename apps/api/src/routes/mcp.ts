import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { initMcpProviders } from "../lib/mcp/providers/index.js";
import { resolveMcpAuth } from "../lib/mcp/auth/resolveMcpAuth.js";
import { handleMcpHttpRequest } from "../lib/mcp/transport/McpSessionManager.js";
import {
  createMcpAccessToken,
  revokeMcpAccessToken,
} from "../lib/mcp/auth/mcpTokenService.js";
import { prisma } from "../db.js";
import type { McpRole } from "../lib/mcp/types.js";

const createTokenSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(["admin", "developer", "support", "audit", "read_only", "custom"]).default("developer"),
  permissions: z.array(z.string()).optional(),
  allowedBotIds: z.array(z.string().uuid()).optional(),
  environment: z.enum(["production", "staging", "development"]).optional(),
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
      message: "Valid MCP token (ocm_), user API token (ocu_), or JWT Bearer required",
      statusCode: 401,
    });
    return null;
  }
  return auth;
}

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

  /** Admin: criar token MCP dedicado */
  app.post("/tokens", { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const body = createTokenSchema.parse(request.body ?? {});
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86400000)
      : null;

    const { token, id, prefix } = await createMcpAccessToken({
      organizationId,
      userId: request.user!.id,
      name: body.name,
      role: body.role as McpRole,
      permissions: body.permissions,
      allowedBotIds: body.allowedBotIds,
      environment: body.environment,
      debugMode: body.debugMode,
      expiresAt,
    });

    return {
      data: {
        id,
        token,
        prefix,
        message: "Store this token securely — it will not be shown again.",
      },
    };
  });

  /** Admin: listar tokens MCP (sem segredos) */
  app.get("/tokens", { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const tokens = await prisma.mcpAccessToken.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        role: true,
        environment: true,
        debugMode: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
        userId: true,
      },
    });
    return { data: tokens };
  });

  /** Admin: revogar token MCP */
  app.delete("/tokens/:id", { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const { id } = request.params as { id: string };
    const ok = await revokeMcpAccessToken(id, organizationId);
    if (!ok) {
      return reply.status(404).send({ error: "Not Found", message: "Token not found", statusCode: 404 });
    }
    return { data: { revoked: true } };
  });

  /** Info do servidor MCP (público) */
  app.get("/info", async () => ({
    name: "opennexo-mcp-server",
    version: "1.0.0",
    protocol: "model-context-protocol",
    transport: "streamable-http",
    endpoint: "/api/v1/mcp",
    auth: ["Bearer ocm_*", "Bearer ocu_*", "Bearer JWT"],
    documentation: "https://modelcontextprotocol.io/",
  }));
}
