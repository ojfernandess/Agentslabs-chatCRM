import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

type Tx = Prisma.TransactionClient;

export type CreateClosureRecordInput = {
  organizationId: string;
  conversationId: string;
  resolvedById: string;
  resolvedAt?: Date;
  assignedToId?: string | null;
  teamId?: string | null;
  leadTypeId?: string | null;
  closureReason?: string | null;
  closureValue?: number | null;
};

async function nextSessionIndex(tx: Tx, conversationId: string): Promise<number> {
  const last = await tx.conversationClosureRecord.findFirst({
    where: { conversationId },
    orderBy: { sessionIndex: "desc" },
    select: { sessionIndex: true },
  });
  return (last?.sessionIndex ?? 0) + 1;
}

function computeIsNewAttendance(
  sessionIndex: number,
  resolvedById: string,
  last: {
    resolvedById: string;
    reopenedById: string | null;
    reopenedAt: Date | null;
  } | null,
): boolean {
  if (sessionIndex <= 1 || !last?.reopenedAt) return false;
  const reopenActor = last.reopenedById ?? last.resolvedById;
  if (reopenActor !== resolvedById) return true;
  if (last.resolvedById !== resolvedById) return true;
  return false;
}

export async function createConversationClosureRecord(
  tx: Tx,
  input: CreateClosureRecordInput,
): Promise<void> {
  const sessionIndex = await nextSessionIndex(tx, input.conversationId);
  const last = await tx.conversationClosureRecord.findFirst({
    where: { conversationId: input.conversationId },
    orderBy: { sessionIndex: "desc" },
    select: { resolvedById: true, reopenedById: true, reopenedAt: true },
  });

  const isNewAttendance = computeIsNewAttendance(sessionIndex, input.resolvedById, last ?? null);

  await tx.conversationClosureRecord.create({
    data: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      sessionIndex,
      resolvedAt: input.resolvedAt ?? new Date(),
      resolvedById: input.resolvedById,
      assignedToId: input.assignedToId ?? null,
      teamId: input.teamId ?? null,
      leadTypeId: input.leadTypeId ?? null,
      closureReason: input.closureReason ?? null,
      closureValue: input.closureValue ?? null,
      isNewAttendance,
    },
  });
}

export async function markConversationClosureReopened(
  tx: Tx,
  input: { conversationId: string; reopenedById: string; reopenedAt?: Date },
): Promise<void> {
  const open = await tx.conversationClosureRecord.findFirst({
    where: { conversationId: input.conversationId, reopenedAt: null },
    orderBy: { sessionIndex: "desc" },
    select: { id: true },
  });
  if (!open) return;
  await tx.conversationClosureRecord.update({
    where: { id: open.id },
    data: {
      reopenedAt: input.reopenedAt ?? new Date(),
      reopenedById: input.reopenedById,
    },
  });
}

export async function applyCsatToLatestOpenClosureRecord(
  conversationId: string,
  data: { csatScore: number; csatComment?: string | null; csatRecordedAt?: Date },
): Promise<void> {
  const record = await prisma.conversationClosureRecord.findFirst({
    where: { conversationId, reopenedAt: null },
    orderBy: { sessionIndex: "desc" },
    select: { id: true },
  });
  if (!record) {
    const latest = await prisma.conversationClosureRecord.findFirst({
      where: { conversationId },
      orderBy: { sessionIndex: "desc" },
      select: { id: true },
    });
    if (!latest) return;
    await prisma.conversationClosureRecord.update({
      where: { id: latest.id },
      data: {
        csatScore: data.csatScore,
        csatComment: data.csatComment ?? null,
        csatRecordedAt: data.csatRecordedAt ?? new Date(),
      },
    });
    return;
  }
  await prisma.conversationClosureRecord.update({
    where: { id: record.id },
    data: {
      csatScore: data.csatScore,
      csatComment: data.csatComment ?? null,
      csatRecordedAt: data.csatRecordedAt ?? new Date(),
    },
  });
}

export const closureRecordInclude = {
  resolvedBy: { select: { id: true, name: true, email: true } },
  reopenedBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  team: { select: { id: true, name: true } },
  leadType: { select: { id: true, name: true, color: true, valueRollup: true } },
} as const;
