import { prisma } from "../../../db.js";
import type { McpAuthContext } from "../types.js";

export type McpAuditInput = {
  ctx: McpAuthContext;
  action: string;
  resourceType?: string;
  resourceId?: string;
  durationMs?: number;
  ok?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export async function logMcpAudit(input: McpAuditInput): Promise<void> {
  try {
    await prisma.mcpAuditLog.create({
      data: {
        organizationId: input.ctx.organizationId,
        userId: input.ctx.userId,
        tokenId: input.ctx.tokenId,
        clientName: input.ctx.clientName,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        ipAddress: input.ctx.ipAddress,
        durationMs: input.durationMs ?? null,
        ok: input.ok ?? true,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    });
  } catch {
    // Auditoria nunca deve bloquear o pedido MCP
  }
}

export async function listMcpAuditLogs(
  organizationId: string,
  opts: { limit?: number; offset?: number; from?: Date; to?: Date } = {},
): Promise<unknown[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const rows = await prisma.mcpAuditLog.findMany({
    where: {
      organizationId,
      ...(opts.from || opts.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      clientName: true,
      durationMs: true,
      ok: true,
      errorMessage: true,
      createdAt: true,
      userId: true,
      tokenId: true,
    },
  });
  return rows;
}
