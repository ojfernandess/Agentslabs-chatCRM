import { MessageDirection, MessageStatus, type MessageBillingLedgerEntry } from "@prisma/client";
import { prisma } from "../db.js";
import { diagnoseMetaDeliveryMessage } from "./metaDeliveryDiagnosisHints.js";
import {
  searchWhatsappWebhookDiagnostics,
  type WhatsappWebhookDiagnosticsRow,
} from "./whatsappWebhookDiagnostics.js";

export { diagnoseMetaDeliveryMessage } from "./metaDeliveryDiagnosisHints.js";

export type MetaDeliveryLedgerSnapshot = {
  billingStatus: string;
  policyDecision: string | null;
  policyReason: string | null;
  failedAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  messageCategory: string;
  metaBillable: boolean | null;
  provider: string | null;
  serviceWindowOpenAtSend: boolean | null;
};

export type MetaDeliveryMessageRow = {
  messageId: string;
  direction: MessageDirection;
  type: string;
  status: MessageStatus;
  providerMsgId: string | null;
  providerError: string | null;
  replyToMessageId: string | null;
  replyToProviderMsgId: string | null;
  replyToExternalMsgId: string | null;
  bodyPreview: string | null;
  isPrivate: boolean;
  channel: string | null;
  sentAt: string;
  createdAt: string;
  actorName: string | null;
  ledger: MetaDeliveryLedgerSnapshot | null;
  diagnosis: string[];
  suggestedActions: string[];
};

export type MetaDeliveryConversationInspection = {
  conversation: {
    id: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    assignedTo: { id: string; name: string } | null;
    contact: { id: string; name: string; phone: string | null; waId: string | null };
    inbox: { id: string; name: string; channelType: string; provider: string | null };
    organization: { id: string; name: string };
  };
  webhook: WhatsappWebhookDiagnosticsRow | null;
  stats: {
    totalMessages: number;
    outbound: number;
    inbound: number;
    failedOutbound: number;
    sentOutbound: number;
    deliveredOutbound: number;
    readOutbound: number;
    blockedLedger: number;
  };
  sessionWindow: {
    open: boolean;
    lastInboundAt: string | null;
    hoursSinceLastInbound: number | null;
  };
  messages: MetaDeliveryMessageRow[];
};

function bodyPreview(body: string | null | undefined, max = 160): string | null {
  const t = body?.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function ledgerSnapshot(entry: MessageBillingLedgerEntry | null | undefined): MetaDeliveryLedgerSnapshot | null {
  if (!entry) return null;
  return {
    billingStatus: entry.billingStatus,
    policyDecision: entry.policyDecision,
    policyReason: entry.policyReason,
    failedAt: entry.failedAt?.toISOString() ?? null,
    deliveredAt: entry.deliveredAt?.toISOString() ?? null,
    readAt: entry.readAt?.toISOString() ?? null,
    messageCategory: entry.messageCategory,
    metaBillable: entry.metaBillable,
    provider: entry.provider,
    serviceWindowOpenAtSend: entry.serviceWindowOpenAtSend,
  };
}

export async function getSuperMetaDeliveryDiagnostics(input: {
  organizationId: string;
  inboxId?: string;
}): Promise<{
  webhook: Awaited<ReturnType<typeof searchWhatsappWebhookDiagnostics>>;
  deliveryStats: {
    last24h: { sent: number; delivered: number; read: number; failed: number; blocked: number };
    last7d: { sent: number; failed: number };
  };
}> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const baseWhere = {
    organizationId: input.organizationId,
    channel: "WHATSAPP",
    ...(input.inboxId ? { inboxId: input.inboxId } : {}),
  };

  const [webhook, ledger24h, sent7d, failed7d] = await Promise.all([
    searchWhatsappWebhookDiagnostics({
      organizationId: input.organizationId,
      inboxId: input.inboxId,
      provider: "meta",
      limit: 50,
      includeEvolutionRemote: false,
    }),
    prisma.messageBillingLedgerEntry.findMany({
      where: { ...baseWhere, sentAt: { gte: since24h } },
      select: { billingStatus: true },
    }),
    prisma.messageBillingLedgerEntry.count({
      where: { ...baseWhere, sentAt: { gte: since7d } },
    }),
    prisma.messageBillingLedgerEntry.count({
      where: {
        ...baseWhere,
        sentAt: { gte: since7d },
        billingStatus: "FAILED",
      },
    }),
  ]);

  const countStatus = (status: string) =>
    ledger24h.filter((r) => r.billingStatus === status).length;

  return {
    webhook,
    deliveryStats: {
      last24h: {
        sent: countStatus("SENT"),
        delivered: countStatus("DELIVERED"),
        read: countStatus("READ"),
        failed: countStatus("FAILED"),
        blocked: countStatus("BLOCKED"),
      },
      last7d: {
        sent: sent7d,
        failed: failed7d,
      },
    },
  };
}

export async function inspectSuperMetaDeliveryConversation(input: {
  organizationId: string;
  conversationId: string;
  inboxId?: string;
  errorsOnly?: boolean;
}): Promise<MetaDeliveryConversationInspection> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      organizationId: input.organizationId,
      ...(input.inboxId ? { inboxId: input.inboxId } : {}),
    },
    include: {
      contact: { select: { id: true, name: true, phone: true, waId: true } },
      inbox: { select: { id: true, name: true, channelType: true, channelConfig: true } },
      organization: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const parsedInbox = conversation.inbox.channelConfig as { whatsappProvider?: string } | null;
  const inboxProvider = parsedInbox?.whatsappProvider ?? null;

  const [messages, ledgers, webhookResult, lastInbound] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      include: {
        actorUser: { select: { id: true, name: true, displayName: true } },
        replyTo: {
          select: { id: true, providerMsgId: true, direction: true, body: true },
        },
      },
    }),
    prisma.messageBillingLedgerEntry.findMany({
      where: { conversationId: conversation.id },
    }),
    searchWhatsappWebhookDiagnostics({
      organizationId: input.organizationId,
      inboxId: conversation.inboxId,
      provider: "meta",
      limit: 1,
      includeEvolutionRemote: false,
    }),
    prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const ledgerByMessageId = new Map(
    ledgers.filter((l) => l.messageId).map((l) => [l.messageId!, l]),
  );

  const hoursSinceLastInbound = lastInbound
    ? (Date.now() - lastInbound.createdAt.getTime()) / (1000 * 60 * 60)
    : null;
  const sessionOpen = hoursSinceLastInbound != null && hoursSinceLastInbound <= 24;

  const outbound = messages.filter((m) => m.direction === MessageDirection.OUTBOUND && !m.isPrivate);
  const failedOutbound = outbound.filter((m) => m.status === MessageStatus.FAILED);

  const rows: MetaDeliveryMessageRow[] = messages
    .filter((m) => !input.errorsOnly || m.status === MessageStatus.FAILED)
    .map((m) => {
      const ledger = ledgerByMessageId.get(m.id) ?? null;
      const { diagnosis, suggestedActions } = diagnoseMetaDeliveryMessage({
        message: m,
        ledger,
        replyTo: m.replyTo,
        inboxProvider,
      });
      return {
        messageId: m.id,
        direction: m.direction,
        type: m.type,
        status: m.status,
        providerMsgId: m.providerMsgId,
        providerError: m.providerError,
        replyToMessageId: m.replyToMessageId,
        replyToProviderMsgId: m.replyTo?.providerMsgId ?? null,
        replyToExternalMsgId: m.replyToExternalMsgId,
        bodyPreview: bodyPreview(m.body),
        isPrivate: m.isPrivate,
        channel: m.channel,
        sentAt: m.sentAt.toISOString(),
        createdAt: m.createdAt.toISOString(),
        actorName: m.actorUser?.displayName?.trim() || m.actorUser?.name?.trim() || null,
        ledger: ledgerSnapshot(ledger),
        diagnosis,
        suggestedActions,
      };
    });

  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      assignedTo: conversation.assignedTo,
      contact: {
        id: conversation.contact.id,
        name: conversation.contact.name,
        phone: conversation.contact.phone,
        waId: conversation.contact.waId,
      },
      inbox: {
        id: conversation.inbox.id,
        name: conversation.inbox.name,
        channelType: conversation.inbox.channelType,
        provider: inboxProvider,
      },
      organization: conversation.organization,
    },
    webhook: webhookResult.inboxes[0] ?? null,
    stats: {
      totalMessages: messages.length,
      outbound: outbound.length,
      inbound: messages.filter((m) => m.direction === MessageDirection.INBOUND).length,
      failedOutbound: failedOutbound.length,
      sentOutbound: outbound.filter((m) => m.status === MessageStatus.SENT).length,
      deliveredOutbound: outbound.filter((m) => m.status === MessageStatus.DELIVERED).length,
      readOutbound: outbound.filter((m) => m.status === MessageStatus.READ).length,
      blockedLedger: ledgers.filter((l) => l.billingStatus === "BLOCKED").length,
    },
    sessionWindow: {
      open: sessionOpen,
      lastInboundAt: lastInbound?.createdAt.toISOString() ?? null,
      hoursSinceLastInbound,
    },
    messages: rows,
  };
}
