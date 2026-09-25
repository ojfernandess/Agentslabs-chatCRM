import type { Contact, Conversation } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { pickEscalationTransferFallbackBody } from "./escalationTransferFallback.js";

export { pickEscalationTransferFallbackBody } from "./escalationTransferFallback.js";

export type EscalationTransferDeliveryResult = {
  delivered: boolean;
  body: string;
  usedFallback: boolean;
  lastError?: Error;
};

async function deliverOneEscalationTransferBody(opts: {
  organizationId: string;
  botId: string;
  conversation: Conversation;
  contact: Contact;
  body: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  await deliverOutboundWhatsAppMessage({
    organizationId: opts.organizationId,
    data: {
      contactId: opts.contact.id,
      conversationId: opts.conversation.id,
      type: "TEXT",
      body: opts.body,
    },
    actor: { kind: "agent_bot", botId: opts.botId },
    log: opts.log,
    newConversation: { status: "PENDING", assignedToId: null },
  });
}

/** Entrega mensagem de transferência com fallback para resposta do modelo. */
export async function deliverEscalationTransferMessage(opts: {
  organizationId: string;
  botId: string;
  conversation: Conversation;
  contact: Contact;
  primaryBody: string;
  fallbackBody?: string | null;
  log: FastifyBaseLogger;
}): Promise<EscalationTransferDeliveryResult> {
  const primary = opts.primaryBody.trim();
  if (!primary) {
    return { delivered: false, body: "", usedFallback: false };
  }

  try {
    await deliverOneEscalationTransferBody({ ...opts, body: primary });
    return { delivered: true, body: primary, usedFallback: false };
  } catch (err) {
    const primaryErr = err instanceof Error ? err : new Error(String(err));
    const fallback = pickEscalationTransferFallbackBody(primary, opts.fallbackBody);
    if (!fallback) {
      return { delivered: false, body: primary, usedFallback: false, lastError: primaryErr };
    }

    try {
      await deliverOneEscalationTransferBody({ ...opts, body: fallback });
      return { delivered: true, body: fallback, usedFallback: true };
    } catch (fallbackErr) {
      const nested =
        fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
      return {
        delivered: false,
        body: fallback,
        usedFallback: true,
        lastError: nested,
      };
    }
  }
}
