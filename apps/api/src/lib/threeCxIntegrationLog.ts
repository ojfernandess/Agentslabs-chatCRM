import { prisma } from "../db.js";

export async function writeThreeCxIntegrationLog(input: {
  organizationId: string;
  threeCxRoutePointId?: string | null;
  level: "info" | "warn" | "error";
  eventType: string;
  message: string;
  payload?: unknown;
}): Promise<void> {
  await prisma.threeCxIntegrationLog.create({
    data: {
      organizationId: input.organizationId,
      threeCxRoutePointId: input.threeCxRoutePointId ?? null,
      level: input.level,
      eventType: input.eventType,
      message: input.message,
      payload: input.payload as object | undefined,
    },
  });
}
