import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type LeadOwnerConflictPayload = {
  originalAgent: { id: string; name: string };
  savedAt: string;
  leadType: { id: string; name: string; color: string };
  closureRecordId: string | null;
  closureReason: string | null;
  closureValue: number | null;
};

type ContactLeadBinding = {
  leadSavedById: string | null;
  leadSavedAt: Date | null;
  leadSavedLeadTypeId: string | null;
  leadSavedClosureRecordId: string | null;
  leadSavedBy?: { id: string; name: string } | null;
  leadSavedLeadType?: {
    id: string;
    name: string;
    color: string;
    enableAgentBinding: boolean;
  } | null;
};

type ConversationLeadPrompt = {
  status: string;
  assignedToId: string | null;
  leadOwnerPromptAction: string | null;
};

export async function applyLeadOwnerBindingOnResolve(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    contactId: string;
    leadTypeId: string;
    savedByUserId: string;
    closureRecordId: string;
  },
): Promise<void> {
  const leadType = await tx.leadType.findFirst({
    where: { id: input.leadTypeId, organizationId: input.organizationId },
    select: { enableAgentBinding: true },
  });
  if (!leadType?.enableAgentBinding) return;

  await tx.contact.update({
    where: { id: input.contactId },
    data: {
      leadSavedById: input.savedByUserId,
      leadSavedAt: new Date(),
      leadSavedLeadTypeId: input.leadTypeId,
      leadSavedClosureRecordId: input.closureRecordId,
    },
  });
}

export async function buildLeadOwnerConflict(
  contact: ContactLeadBinding,
  conversation: ConversationLeadPrompt,
  currentUserId: string,
): Promise<LeadOwnerConflictPayload | null> {
  if (conversation.status !== "OPEN" && conversation.status !== "PENDING") return null;
  if (conversation.leadOwnerPromptAction) return null;
  if (!contact.leadSavedById || !contact.leadSavedAt || !contact.leadSavedLeadTypeId) return null;
  if (!contact.leadSavedLeadType?.enableAgentBinding) return null;
  if (contact.leadSavedById === currentUserId) return null;

  const isDirectedToCurrentUser =
    conversation.assignedToId === currentUserId || conversation.assignedToId == null;
  if (!isDirectedToCurrentUser) return null;

  let closureReason: string | null = null;
  let closureValue: number | null = null;
  if (contact.leadSavedClosureRecordId) {
    const record = await prisma.conversationClosureRecord.findUnique({
      where: { id: contact.leadSavedClosureRecordId },
      select: { closureReason: true, closureValue: true },
    });
    closureReason = record?.closureReason ?? null;
    closureValue = record?.closureValue ?? null;
  }

  const agentName = contact.leadSavedBy?.name?.trim() || "—";

  return {
    originalAgent: { id: contact.leadSavedById, name: agentName },
    savedAt: contact.leadSavedAt.toISOString(),
    leadType: {
      id: contact.leadSavedLeadType.id,
      name: contact.leadSavedLeadType.name,
      color: contact.leadSavedLeadType.color,
    },
    closureRecordId: contact.leadSavedClosureRecordId,
    closureReason,
    closureValue,
  };
}

export async function findTeamForLeadOwnerTransfer(
  tx: Prisma.TransactionClient,
  organizationId: string,
  originalAgentId: string,
  currentTeamId: string | null,
): Promise<string | null> {
  if (currentTeamId) {
    const inCurrent = await tx.teamMember.findFirst({
      where: {
        userId: originalAgentId,
        teamId: currentTeamId,
        team: { organizationId },
      },
      select: { teamId: true },
    });
    if (inCurrent) return currentTeamId;
  }

  const first = await tx.teamMember.findFirst({
    where: { userId: originalAgentId, team: { organizationId } },
    select: { teamId: true },
    orderBy: { teamId: "asc" },
  });
  return first?.teamId ?? null;
}

export const contactLeadBindingInclude = {
  leadSavedBy: { select: { id: true, name: true } },
  leadSavedLeadType: {
    select: { id: true, name: true, color: true, enableAgentBinding: true },
  },
} as const;
