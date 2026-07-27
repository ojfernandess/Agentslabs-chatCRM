import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { JwtPayload } from "../../../middleware/auth.js";
import type { McpAuthContext } from "../types.js";
import { MCP_ROLE_PERMISSIONS, resolvePermissions } from "../access/permissions.js";
import { verifyMcpToken } from "./mcpTokenService.js";

function bearerRawToken(request: FastifyRequest): string | null {
  const h = request.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

function headerValueAsString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return null;
}

function actingOrganizationIdFromRequest(request: FastifyRequest): string | null {
  const keys = [
    "openconduit-organization-id",
    "x-openconduit-organization-id",
    "organization-id",
    "x-organization-id",
    "organization_id",
    "org-id",
    "x-org-id",
    "tenant-id",
    "x-tenant-id",
  ];
  for (const key of keys) {
    const raw = headerValueAsString(request.headers[key]);
    if (!raw) continue;
    const id = z.string().uuid().safeParse(raw.trim()).data;
    if (id) return id;
  }
  return null;
}

function clientNameFromRequest(request: FastifyRequest): string | null {
  return (
    headerValueAsString(request.headers["x-mcp-client"]) ??
    headerValueAsString(request.headers["user-agent"])?.slice(0, 120) ??
    null
  );
}

/** Contexto MCP exclusivo para super admin da plataforma. */
function superAdminJwtToAuthContext(
  user: JwtPayload,
  ip: string | null,
  orgHeader: string | null,
): McpAuthContext {
  const organizationId = user.actingOrganizationId ?? orgHeader;
  if (!organizationId) {
    throw new Error(
      "Super admin MCP requires tenant context: enter an organization in the console or send organization-id header",
    );
  }
  return {
    organizationId,
    userId: user.id,
    tokenId: null,
    role: "admin",
    permissions: new Set(MCP_ROLE_PERMISSIONS.admin),
    allowedBotIds: null,
    environment: null,
    debugMode: true,
    authMethod: "jwt",
    clientName: null,
    ipAddress: ip,
  };
}

/**
 * Resolve autenticação MCP — apenas SUPER_ADMIN.
 * Aceita token dedicado ocm_ (criado no painel super admin) ou JWT de sessão super admin.
 */
export async function resolveMcpAuth(request: FastifyRequest): Promise<McpAuthContext | null> {
  const ip = request.ip ?? null;
  const clientName = clientNameFromRequest(request);
  const bearer = bearerRawToken(request);
  const apiAccess = headerValueAsString(request.headers["api_access_token"]);
  const orgHeader = actingOrganizationIdFromRequest(request);

  // 1. Token MCP dedicado (ocm_) — só tokens criados por super admin
  const mcpRaw = bearer?.startsWith("ocm_") ? bearer : apiAccess?.startsWith("ocm_") ? apiAccess : null;
  if (mcpRaw) {
    const record = await verifyMcpToken(mcpRaw);
    if (!record) return null;
    return {
      organizationId: record.organizationId,
      userId: record.userId,
      tokenId: record.id,
      role: record.role,
      permissions: record.permissions,
      allowedBotIds: record.allowedBotIds,
      environment: record.environment,
      debugMode: record.debugMode,
      authMethod: "mcp_token",
      clientName,
      ipAddress: ip,
    };
  }

  // 2. JWT — apenas SUPER_ADMIN
  if (bearer && !bearer.startsWith("ocb_") && !bearer.startsWith("ocu_")) {
    try {
      const decoded = await request.server.jwt.verify<JwtPayload>(bearer);
      if (decoded.role !== "SUPER_ADMIN") return null;
      const ctx = superAdminJwtToAuthContext(decoded, ip, orgHeader);
      return { ...ctx, clientName };
    } catch {
      return null;
    }
  }

  return null;
}

export function assertBotAccess(ctx: McpAuthContext, botId: string): void {
  if (!ctx.allowedBotIds?.length) return;
  if (!ctx.allowedBotIds.includes(botId)) {
    throw new Error(`Access to agent ${botId} is not allowed for this token`);
  }
}
