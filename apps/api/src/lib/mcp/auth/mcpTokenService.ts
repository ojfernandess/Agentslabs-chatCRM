import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../../db.js";
import type { McpRole, McpPermission } from "../types.js";
import { resolvePermissions } from "../access/permissions.js";

export const MCP_TOKEN_PREFIX = "ocm_";

export function generateMcpTokenParts(): { token: string; prefix: string } {
  const suffix = randomBytes(24).toString("hex");
  const token = `${MCP_TOKEN_PREFIX}${suffix}`;
  return { token, prefix: token.slice(0, 12) };
}

export async function hashMcpToken(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export type McpTokenRecord = {
  id: string;
  organizationId: string;
  userId: string | null;
  role: McpRole;
  permissions: Set<McpPermission>;
  allowedBotIds: string[] | null;
  environment: string | null;
  debugMode: boolean;
};

async function assertSuperAdminUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === "SUPER_ADMIN";
}

export async function verifyMcpToken(raw: string): Promise<McpTokenRecord | null> {
  if (!raw.startsWith(MCP_TOKEN_PREFIX) || raw.length < MCP_TOKEN_PREFIX.length + 16) {
    return null;
  }
  const prefix = raw.slice(0, 12);
  const candidates = await prisma.mcpAccessToken.findMany({
    where: { tokenPrefix: prefix, revokedAt: null },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      role: true,
      permissions: true,
      allowedBotIds: true,
      environment: true,
      debugMode: true,
      tokenHash: true,
      expiresAt: true,
    },
    take: 20,
  });

  for (const c of candidates) {
    if (c.expiresAt && c.expiresAt < new Date()) continue;
    const ok = await bcrypt.compare(raw, c.tokenHash);
    if (!ok) continue;

    const creatorIsSuperAdmin = await assertSuperAdminUser(c.userId);
    if (!creatorIsSuperAdmin) continue;

    await prisma.mcpAccessToken.update({
      where: { id: c.id },
      data: { lastUsedAt: new Date() },
    });

    const customPerms =
      c.role === "custom" && Array.isArray(c.permissions)
        ? (c.permissions as string[])
        : null;
    const perms = resolvePermissions(c.role as McpRole, customPerms);

    let allowedBotIds: string[] | null = null;
    if (Array.isArray(c.allowedBotIds)) {
      allowedBotIds = (c.allowedBotIds as unknown[]).filter((x): x is string => typeof x === "string");
    }

    return {
      id: c.id,
      organizationId: c.organizationId,
      userId: c.userId,
      role: c.role as McpRole,
      permissions: perms,
      allowedBotIds,
      environment: c.environment,
      debugMode: c.debugMode,
    };
  }
  return null;
}

export async function createMcpAccessToken(input: {
  organizationId: string;
  userId: string;
  name: string;
  role?: McpRole;
  permissions?: string[];
  allowedBotIds?: string[];
  environment?: string;
  debugMode?: boolean;
  expiresAt?: Date | null;
}): Promise<{ token: string; id: string; prefix: string }> {
  const creatorOk = await assertSuperAdminUser(input.userId);
  if (!creatorOk) {
    throw new Error("Only super admin users can create MCP tokens");
  }

  const { token, prefix } = generateMcpTokenParts();
  const hash = await hashMcpToken(token);
  const row = await prisma.mcpAccessToken.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      tokenPrefix: prefix,
      tokenHash: hash,
      role: input.role ?? "admin",
      permissions: input.permissions?.length ? input.permissions : undefined,
      allowedBotIds: input.allowedBotIds?.length ? input.allowedBotIds : undefined,
      environment: input.environment ?? null,
      debugMode: input.debugMode ?? true,
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true },
  });
  return { token, id: row.id, prefix };
}

/** Revoga token MCP (super admin — qualquer organização). */
export async function revokeMcpAccessTokenById(id: string): Promise<boolean> {
  const r = await prisma.mcpAccessToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count > 0;
}

export async function listMcpAccessTokensForSuperAdmin(): Promise<
  Array<{
    id: string;
    name: string;
    tokenPrefix: string;
    role: string;
    environment: string | null;
    debugMode: boolean;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    organization: { id: string; name: string; slug: string };
    user: { id: string; email: string; name: string } | null;
  }>
> {
  return prisma.mcpAccessToken.findMany({
    where: { revokedAt: null },
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
      organization: { select: { id: true, name: true, slug: true } },
      user: { select: { id: true, email: true, name: true } },
    },
  });
}
