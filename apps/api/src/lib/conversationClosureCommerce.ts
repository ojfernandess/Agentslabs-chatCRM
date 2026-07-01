import type { LeadValueRollup, Prisma } from "@prisma/client";
import {
  resolveLeadTypeClosurePlaybook,
  shouldCreateDealOnConversationClosure,
  type LeadTypeClosurePlaybook,
  type LeadValueRollupKind,
} from "@openconduit/shared";
import { getOrCreateDefaultPipeline } from "./defaultPipeline.js";
import { ensurePipelineStageForLeadType } from "./pipelineLeadTypeSync.js";
import { dealStatusFromLeadValueRollup, syncDealsForContactPipelineStage } from "./dealStageSync.js";

type Tx = Prisma.TransactionClient;

export type ClosureDealResult = {
  id: string;
  name: string;
  primaryContactId: string | null;
} | null;

export type ClosureReminderResult = {
  id: string;
  dueAt: Date;
} | null;

export function rollupKind(rollup: LeadValueRollup): LeadValueRollupKind {
  return rollup as LeadValueRollupKind;
}

export async function applyContactStageForLeadType(
  tx: Tx,
  organizationId: string,
  contactId: string,
  leadTypeId: string,
): Promise<{ id: string; probabilityPct: number }> {
  const stage = await ensurePipelineStageForLeadType(tx, organizationId, leadTypeId);
  await tx.contact.update({
    where: { id: contactId },
    data: { pipelineStageId: stage.id },
  });
  await syncDealsForContactPipelineStage(tx, organizationId, contactId, stage.id);
  return { id: stage.id, probabilityPct: stage.probabilityPct };
}

export async function maybeCreateDealOnConversationClosure(
  tx: Tx,
  input: {
    organizationId: string;
    conversationId: string;
    closureRecordId: string;
    contactId: string;
    ownerUserId: string;
    leadTypeId: string;
    closureValue: number | null | undefined;
    stage: { id: string; probabilityPct: number };
    valueRollup: LeadValueRollup;
    playbook: LeadTypeClosurePlaybook;
  },
): Promise<ClosureDealResult> {
  if (
    !shouldCreateDealOnConversationClosure({
      closureValue: input.closureValue,
      valueRollup: rollupKind(input.valueRollup),
      playbook: input.playbook,
    })
  ) {
    return null;
  }

  const pipeline = await getOrCreateDefaultPipeline(tx, input.organizationId);
  const contactRow = await tx.contact.findFirst({
    where: { id: input.contactId, organizationId: input.organizationId },
    select: { name: true },
  });
  const val = input.closureValue ?? 0;
  const dealStatus = dealStatusFromLeadValueRollup(input.valueRollup);
  const deal = await tx.deal.create({
    data: {
      organizationId: input.organizationId,
      name: `Negócio — ${contactRow?.name ?? "Contacto"}`,
      pipelineId: pipeline.id,
      stageId: input.stage.id,
      primaryContactId: input.contactId,
      ownerId: input.ownerUserId,
      amountCents: Math.round(Math.max(0, val) * 100),
      currency: "BRL",
      status: dealStatus,
      probabilityPct: input.stage.probabilityPct,
      sourceConversationId: input.conversationId,
      sourceClosureRecordId: input.closureRecordId,
    },
  });
  return { id: deal.id, name: deal.name, primaryContactId: deal.primaryContactId };
}

export async function maybeCreateReminderOnConversationClosure(
  tx: Tx,
  input: {
    organizationId: string;
    conversationId: string;
    closureRecordId: string;
    contactId: string;
    userId: string;
    note: string;
    dueAt: Date;
  },
): Promise<ClosureReminderResult> {
  const note = input.note.trim();
  if (!note) return null;
  const reminder = await tx.reminder.create({
    data: {
      organizationId: input.organizationId,
      contactId: input.contactId,
      userId: input.userId,
      note,
      dueAt: input.dueAt,
      conversationId: input.conversationId,
      closureRecordId: input.closureRecordId,
    },
  });
  return { id: reminder.id, dueAt: reminder.dueAt };
}

export async function loadLeadTypePlaybook(
  tx: Tx,
  leadTypeId: string,
  organizationId: string,
): Promise<{ valueRollup: LeadValueRollup; playbook: LeadTypeClosurePlaybook } | null> {
  const lt = await tx.leadType.findFirst({
    where: { id: leadTypeId, organizationId },
    select: { valueRollup: true, closurePlaybook: true },
  });
  if (!lt) return null;
  return {
    valueRollup: lt.valueRollup,
    playbook: resolveLeadTypeClosurePlaybook(lt.closurePlaybook, rollupKind(lt.valueRollup)),
  };
}
