import { prisma } from "../db.js";

export async function writeNvoipIntegrationLog(input: {
  organizationId: string;
  nvoipAccountId?: string | null;
  level: "info" | "warn" | "error";
  eventType: string;
  message: string;
  payload?: unknown;
}) {
  await prisma.nvoipIntegrationLog.create({
    data: {
      organizationId: input.organizationId,
      nvoipAccountId: input.nvoipAccountId ?? null,
      level: input.level,
      eventType: input.eventType,
      message: input.message,
      payload: input.payload as object | undefined,
    },
  });
}
