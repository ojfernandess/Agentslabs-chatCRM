import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export async function appendTimelineEvent(args: {
  organizationId: string;
  subjectType: "CONTACT" | "ACCOUNT" | "DEAL";
  subjectId: string;
  eventType: string;
  channel?: string | null;
  payload: Prisma.InputJsonValue;
  actorUserId?: string | null;
  sourceId?: string | null;
  occurredAt?: Date;
}): Promise<void> {
  await prisma.timelineEvent.create({
    data: {
      organizationId: args.organizationId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      eventType: args.eventType,
      channel: args.channel ?? undefined,
      payload: args.payload,
      actorUserId: args.actorUserId ?? undefined,
      sourceId: args.sourceId ?? undefined,
      occurredAt: args.occurredAt ?? new Date(),
    },
  });
}
