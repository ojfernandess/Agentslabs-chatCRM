import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type WavoipLogLevel = "info" | "warn" | "error";

export async function logWavoipIntegration(input: {
  organizationId: string;
  wavoipDeviceId?: string | null;
  level: WavoipLogLevel;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await prisma.wavoipIntegrationLog.create({
    data: {
      organizationId: input.organizationId,
      wavoipDeviceId: input.wavoipDeviceId ?? null,
      level: input.level,
      eventType: input.eventType,
      message: input.message.slice(0, 4000),
      payload:
        input.payload === undefined ? undefined : (input.payload as Prisma.InputJsonValue),
    },
  });
}
