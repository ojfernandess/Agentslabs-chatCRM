import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticateUserApiToken } from "../../../middleware/userApiTokenAuth.js";
import type { JwtPayload } from "../../../middleware/auth.js";
import type { McpAuthContext, McpRole } from "../types.js";
import { resolvePermissions } from "../access/permissions.js";
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

function userRoleToMcpRole(role: string): McpRole {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return "admin";
  if (role === "AGENT") return "support";
  return "read_only";
}

function jwtToAuthContext(user: JwtPayload, ip: string | null): McpAuthContext {
  const orgId = user.actingOrganizationId ?? user.organizationId;
  if (!orgId) {
    throw new Error("JWT without organization context");
  }
  const mcpRole = userRoleToMcpRole(user.role);
  return {
    organizationId: orgId,
    userId: user.id,
    tokenId: null,
    role: mcpRole,
    permissions: resolvePermissions(mcpRole),
    allowedBotIds: null,
    environment: null,
    debugMode: mcpRole === "admin" || mcpRole === "developer",
    authMethod: "jwt",
    clientName: null,
    ipAddress: ip,
  };
}

/** Resolve autenticação MCP: ocm_ token, ocu_ token, ou JWT Bearer. */
export async function resolveMcpAuth(request: FastifyRequest): Promise<McpAuthContext | null> {
  const ip = request.ip ?? null;
  const clientName = clientNameFromRequest(request);
  const bearer = bearerRawToken(request);
  const apiAccess = headerValueAsString(request.headers["api_access_token"]);

  // 1. Token MCP dedicado (ocm_)
  const mcpRaw = bearer?.startsWith("ocm_") ? bearer : apiAccess?.startsWith("ocm_") ? apiAccess : null;
  if (mcpRaw) {
    const record = await verifyMcpToken(mcpRaw);
    if (!record) return null;
    return {
      organizationId: record.organizationId,
      userId: record.userId,
      tokenId: record.id,
      role: record.role,
      permissions: record.permissions as McpAuthContext["permissions"],
      allowedBotIds: record.allowedBotIds,
      environment: record.environment,
      debugMode: record.debugMode,
      authMethod: "mcp_token",
      clientName,
      ipAddress: ip,
    };
  }

  // 2. User API token (ocu_) — reutiliza middleware existente
  if (bearer?.startsWith("ocu_") || apiAccess?.startsWith("ocu_")) {
    const fakeReply = {
      status: () => fakeReply,
      send: () => fakeReply,
    } as never;
    const user = await authenticateUserApiToken(request, fakeReply);
    if (!user) return null;
    const orgHeader = actingOrganizationIdFromRequest(request);
    const orgId =
      user.role === "SUPER_ADMIN"
        ? orgHeader ?? user.actingOrganizationId ?? user.organizationId
        : user.organizationId;
    if (!orgId) return null;
    const mcpRole = userRoleToMcpRole(user.role);
    return {
      organizationId: orgId,
      userId: user.id,
      tokenId: null,
      role: mcpRole,
      permissions: resolvePermissions(mcpRole),
      allowedBotIds: null,
      environment: null,
      debugMode: mcpRole === "admin" || mcpRole === "developer",
      authMethod: "user_api_token",
      clientName,
      ipAddress: ip,
    };
  }

  // 3. JWT session (web UI / integrações)
  if (bearer && !bearer.startsWith("ocb_")) {
    try {
      const decoded = await request.server.jwt.verify<JwtPayload>(bearer);
      const ctx = jwtToAuthContext(decoded, ip);
      return { ...ctx, clientName };
    } catch {
      // não é JWT válido
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
