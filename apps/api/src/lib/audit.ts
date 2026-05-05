import type { FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export function clientIp(request: FastifyRequest): string | undefined {
  const x = request.headers["x-forwarded-for"];
  if (typeof x === "string" && x.trim()) return x.split(",")[0]?.trim();
  return request.ip;
}

export async function recordAuditLog(input: {
  actorUserId: string;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata:
        input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
      ip: input.ip ?? null,
    },
  });
}
