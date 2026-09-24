import type { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import {
  computeAgentBotTriageActive,
  getAgentBotDispatchContextForInbox,
} from "./agentBotTriage.js";
import {
  buildWebsiteVisitorIndexMap,
  enrichWebsiteContact,
} from "./websiteVisitorContacts.js";
import { loadActiveVoiceCallsByConversation } from "./activeVoiceCalls.js";
import { loadEmailStateByConversation } from "./conversationUserEmailState.js";
import {
  hasContactAvatarCache,
  syncContactProfilePicture,
} from "./contactProfilePictureResolve.js";
import { loadLastReadAtByConversation, withUnreadFlag } from "./teamTransferUnread.js";

const contactListSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  profilePictureUrl: true,
  createdAt: true,
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  pipelineStage: {
    select: { id: true, name: true, color: true, leadTypeId: true },
  },
  tags: {
    select: {
      tag: { select: { id: true, name: true, color: true } },
    },
  },
} as const;

function stripCsatSurveyToken<C extends { csatSurveyToken?: string | null; csatScore?: number | null; status: string }>(
  row: C,
): Omit<C, "csatSurveyToken"> & { csatSurveyPending: boolean } {
  const { csatSurveyToken, ...rest } = row;
  return {
    ...rest,
    csatSurveyPending:
      row.status === "RESOLVED" && csatSurveyToken != null && row.csatScore == null,
  } as Omit<C, "csatSurveyToken"> & { csatSurveyPending: boolean };
}

/** Linha única da lista lateral (mesmo formato que GET /conversations). */
export async function fetchConversationListRow(
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId, deletedAt: null },
    include: {
      contact: { select: contactListSelect },
      assignedTo: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      inbox: {
        select: { id: true, name: true, isDefault: true, channelType: true, channelConfig: true },
      },
      leadType: { select: { id: true, name: true, color: true, valueRollup: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!row) return null;

  const agentCtx = await getAgentBotDispatchContextForInbox(organizationId, row.inboxId);
  const inboxChannelType =
    row.inbox?.channelType && typeof row.inbox.channelType === "string"
      ? (row.inbox.channelType as InboxChannelType)
      : ("WHATSAPP" as InboxChannelType);
  const agentBotTriageActive = computeAgentBotTriageActive(agentCtx, inboxChannelType);

  const lastReadByConversation = await loadLastReadAtByConversation(prisma, userId, [row.id]);
  const withFlag = withUnreadFlag(
    [{ ...row, lastMessage: row.messages[0] ?? null }],
    lastReadByConversation,
  )[0];

  const contactHasAvatar = await hasContactAvatarCache(organizationId, row.contact.id);
  void syncContactProfilePicture({
    organizationId,
    contactId: row.contact.id,
    phone: row.contact.phone,
    profilePictureUrl: row.contact.profilePictureUrl,
  }).catch(() => {});

  const activeVoiceByConversation = await loadActiveVoiceCallsByConversation(organizationId, [row.id]);
  const emailStateByConversation = await loadEmailStateByConversation(prisma, userId, [row.id]);
  const websiteVisitorIndexMap =
    row.inbox?.channelType === "WEBSITE"
      ? await buildWebsiteVisitorIndexMap(organizationId)
      : new Map<string, number>();

  const { lastMessage: _lastMessage, ...rest } = withFlag;
  const emailState = emailStateByConversation.get(row.id);
  const contactBase = {
    ...rest.contact,
    hasAvatar: contactHasAvatar,
    thumbnail: contactHasAvatar ? `/api/v1/contacts/${rest.contact.id}/profile-picture` : null,
  };

  return {
    ...stripCsatSurveyToken(rest),
    agentBotTriageActive,
    isUnread: withFlag.isUnread,
    isStarred: emailState?.isStarred ?? false,
    emailFolderId: emailState?.emailFolderId ?? null,
    activeVoiceCall: activeVoiceByConversation.get(row.id) ?? null,
    contact: enrichWebsiteContact(contactBase, websiteVisitorIndexMap),
  };
}

export type ConversationListSyncPayload = {
  conversationId: string;
  status?: string;
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string } | null;
  teamId?: string | null;
  inboxId?: string;
  awaitingHumanHandoff?: boolean;
  agentBotTriageActive?: boolean;
  updatedAt?: string;
};

export function buildConversationListSyncPayload(input: {
  id: string;
  status: string;
  assignedToId: string | null;
  assignedTo?: { id: string; name: string } | null;
  teamId: string | null;
  inboxId: string;
  awaitingHumanHandoff: boolean;
  updatedAt: Date;
  agentBotTriageActive: boolean;
}): ConversationListSyncPayload {
  return {
    conversationId: input.id,
    status: input.status,
    assignedToId: input.assignedToId,
    assignedTo: input.assignedTo ?? null,
    teamId: input.teamId,
    inboxId: input.inboxId,
    awaitingHumanHandoff: input.awaitingHumanHandoff,
    agentBotTriageActive: input.agentBotTriageActive,
    updatedAt: input.updatedAt.toISOString(),
  };
}
