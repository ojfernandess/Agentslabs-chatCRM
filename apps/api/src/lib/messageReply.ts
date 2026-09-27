import { prisma } from "../db.js";

export type MessageReplyToApi = {
  id: string;
  available: boolean;
  direction: string;
  type: string;
  preview: string;
  senderLabel: string;
};

export const messageReplyToInclude = {
  select: {
    id: true,
    body: true,
    type: true,
    direction: true,
    mediaType: true,
    mediaUrl: true,
    isPrivate: true,
    actorUser: { select: { id: true, name: true, displayName: true } },
  },
} as const;

type ReplyRow = {
  id: string;
  body: string | null;
  type: string;
  direction: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  isPrivate?: boolean;
  actorUser?: { id: string; name: string; displayName: string | null } | null;
};

export function buildMessageReplyPreview(
  row: ReplyRow | null | undefined,
  contactName: string,
): MessageReplyToApi | null {
  if (!row) return null;
  const senderLabel =
    row.direction === "INBOUND"
      ? contactName.trim() || "Cliente"
      : row.actorUser?.displayName?.trim() || row.actorUser?.name || "Atendente";
  return {
    id: row.id,
    available: true,
    direction: row.direction,
    type: row.type,
    preview: previewTextForMessage(row),
    senderLabel,
  };
}

export function unavailableReplyPreview(): MessageReplyToApi {
  return {
    id: "",
    available: false,
    direction: "INBOUND",
    type: "TEXT",
    preview: "",
    senderLabel: "",
  };
}

function previewTextForMessage(row: ReplyRow): string {
  if (row.isPrivate) return "Nota interna";
  switch (row.type) {
    case "IMAGE":
      return "📷 Foto";
    case "AUDIO":
      return "🎤 Áudio";
    case "VIDEO":
      return "🎥 Vídeo";
    case "DOCUMENT": {
      const name = row.body?.trim();
      return name ? `📄 ${truncatePreview(name, 48)}` : "📄 Documento";
    }
    case "TEMPLATE":
      return row.body?.trim() ? truncatePreview(row.body.trim(), 120) : "Template";
    default: {
      const text = row.body?.trim() ?? "";
      return text ? truncatePreview(text, 120) : "Mensagem";
    }
  }
}

function truncatePreview(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function supportsWhatsAppQuotedReply(providerKind: string | null | undefined): boolean {
  return providerKind === "meta" || providerKind === "360dialog";
}

export async function resolveInboundReplyTarget(params: {
  organizationId: string;
  conversationId: string;
  quotedProviderMsgId?: string | null;
}): Promise<{ replyToMessageId: string | null; replyToExternalMsgId: string | null }> {
  const external = params.quotedProviderMsgId?.trim() || null;
  if (!external) {
    return { replyToMessageId: null, replyToExternalMsgId: null };
  }
  const target = await prisma.message.findFirst({
    where: {
      providerMsgId: external,
      conversationId: params.conversationId,
      conversation: { organizationId: params.organizationId },
    },
    select: { id: true },
  });
  if (target) {
    return { replyToMessageId: target.id, replyToExternalMsgId: null };
  }
  return { replyToMessageId: null, replyToExternalMsgId: external };
}

export function resolveMessageReplyForApi(
  message: {
    replyToMessageId?: string | null;
    replyToExternalMsgId?: string | null;
    replyTo?: ReplyRow | null;
  },
  contactName: string,
): MessageReplyToApi | null {
  if (message.replyTo) {
    return buildMessageReplyPreview(message.replyTo, contactName);
  }
  if (message.replyToExternalMsgId?.trim()) {
    return unavailableReplyPreview();
  }
  return null;
}

export async function resolveOutboundReplyTarget(params: {
  organizationId: string;
  conversationId: string;
  replyToMessageId: string;
}): Promise<{ replyToMessageId: string; replyToProviderMsgId: string } | null> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId: params.organizationId },
    select: { replyToMessageEnabled: true },
  });
  if (!settings?.replyToMessageEnabled) return null;

  const target = await prisma.message.findFirst({
    where: {
      id: params.replyToMessageId,
      conversationId: params.conversationId,
      conversation: { organizationId: params.organizationId },
      isPrivate: false,
    },
    select: { id: true, providerMsgId: true },
  });
  if (!target?.providerMsgId) return null;
  return { replyToMessageId: target.id, replyToProviderMsgId: target.providerMsgId };
}
