export type ConversationMessageReply = {
  id: string;
  available: boolean;
  direction: string;
  type: string;
  preview: string;
  senderLabel: string;
};

type RawReplyRow = {
  id: string;
  body?: string | null;
  type: string;
  direction: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  isPrivate?: boolean;
  actorUser?: { id: string; name: string; displayName: string | null } | null;
};

function truncatePreview(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function previewTextForMessage(row: RawReplyRow): string {
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

function buildReplyPreview(row: RawReplyRow, contactName: string): ConversationMessageReply {
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

export function buildComposerReplyFromMessage(
  message: {
    id: string;
    body?: string | null;
    type: string;
    direction: string;
    mediaType?: string | null;
    mediaUrl?: string | null;
    isPrivate?: boolean;
    actorUser?: { id: string; name: string; displayName: string | null } | null;
  },
  contactName: string,
): ConversationMessageReply {
  return buildReplyPreview(message, contactName);
}

export function normalizeConversationMessageReply(
  message: {
    replyTo?: unknown;
    replyToExternalMsgId?: string | null;
    replyToMessageId?: string | null;
  },
  contactName: string,
): ConversationMessageReply | null {
  const rawReply = message.replyTo;
  if (rawReply && typeof rawReply === "object") {
    const row = rawReply as Record<string, unknown>;
    if (row.available === false) {
      return {
        id: typeof row.id === "string" ? row.id : "",
        available: false,
        direction: typeof row.direction === "string" ? row.direction : "INBOUND",
        type: typeof row.type === "string" ? row.type : "TEXT",
        preview: typeof row.preview === "string" ? row.preview : "",
        senderLabel: typeof row.senderLabel === "string" ? row.senderLabel : "",
      };
    }
    if (row.available === true && typeof row.preview === "string") {
      return row as ConversationMessageReply;
    }
    if (typeof row.id === "string" && typeof row.type === "string") {
      return buildReplyPreview(row as RawReplyRow, contactName);
    }
  }
  if (message.replyToExternalMsgId?.trim()) {
    return {
      id: "",
      available: false,
      direction: "INBOUND",
      type: "TEXT",
      preview: "",
      senderLabel: "",
    };
  }
  const replyToMessageId = message.replyToMessageId?.trim();
  if (replyToMessageId) {
    return {
      id: replyToMessageId,
      available: true,
      direction: "INBOUND",
      type: "TEXT",
      preview: "Mensagem",
      senderLabel: "",
    };
  }
  return null;
}
