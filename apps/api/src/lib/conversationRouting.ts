import type { Conversation } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getDefaultInboxId } from "./defaultInbox.js";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Com agent bot ativo pedimos `activeConversationStatus === "PENDING"`.
 * Conversas antigas em `OPEN` sem atendente continuavam nesse estado — `dispatchAgentBotWebhook` só corre em `PENDING`,
 * por isso o bot nunca era notificado. Reabre para a fila do bot quando ainda não há atribuição humana.
 */
async function triageOpenUnassignedForAgentBot(
  conv: Conversation,
  activeConversationStatus: "OPEN" | "PENDING",
  db: DbClient = prisma,
): Promise<Conversation> {
  if (activeConversationStatus !== "PENDING") {
    return conv;
  }
  if (conv.status !== "OPEN" || conv.assignedToId != null) {
    return conv;
  }
  return db.conversation.update({
    where: { id: conv.id },
    data: { status: "PENDING", updatedAt: new Date() },
  });
}

const TEMPLATE_REPLY_REOPEN_MS = 7 * 24 * 60 * 60 * 1000;

/** Nova mensagem após RESOLVED: não herdar atendente nem dados de encerramento (igual à reabertura manual no painel). */
export function reopenResolvedConversationData(activeConversationStatus: "OPEN" | "PENDING") {
  return {
    status: activeConversationStatus,
    updatedAt: new Date(),
    assignedToId: null,
    closureReason: null,
    closureValue: null,
    leadTypeId: null,
    csatScore: null,
    csatComment: null,
    csatRecordedAt: null,
    csatSurveyToken: null,
  } as const;
}

/**
 * Escolhe ou cria a conversa WhatsApp do contacto.
 * lockSingleConversation: reutiliza a conversa mais recente e reabre RESOLVED (uma thread por contacto).
 */
export async function ensureConversationForWhatsAppContact(params: {
  organizationId: string;
  contactId: string;
  lockSingleConversation: boolean;
  /** Após reabrir RESOLVED, ou para promover PENDING → OPEN quando aplicável. */
  activeConversationStatus: "OPEN" | "PENDING";
  createDefaults: { status: "OPEN" | "PENDING"; assignedToId?: string | null };
}): Promise<Conversation> {
  const {
    organizationId,
    contactId,
    lockSingleConversation,
    activeConversationStatus,
    createDefaults,
  } = params;

  const promotePendingToOpen = activeConversationStatus === "OPEN";

  if (lockSingleConversation) {
    let conv = await prisma.conversation.findFirst({
      where: { organizationId, contactId },
      orderBy: { updatedAt: "desc" },
    });
    if (conv) {
      if (conv.status === "RESOLVED") {
        return prisma.conversation.update({
          where: { id: conv.id },
          data: reopenResolvedConversationData(activeConversationStatus),
        });
      }
      if (conv.status === "PENDING" && promotePendingToOpen) {
        return prisma.conversation.update({
          where: { id: conv.id },
          data: { status: "OPEN", updatedAt: new Date() },
        });
      }
      return triageOpenUnassignedForAgentBot(conv, activeConversationStatus);
    }
    const inboxId = await getDefaultInboxId(organizationId);
    return prisma.conversation.create({
      data: {
        organizationId,
        inboxId,
        contactId,
        status: createDefaults.status,
        assignedToId: createDefaults.assignedToId ?? undefined,
      },
    });
  }

  let conv = await prisma.conversation.findFirst({
    where: { organizationId, contactId, status: { not: "RESOLVED" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conv) {
    const inboxId = await getDefaultInboxId(organizationId);
    return prisma.conversation.create({
      data: {
        organizationId,
        inboxId,
        contactId,
        status: createDefaults.status,
        assignedToId: createDefaults.assignedToId ?? undefined,
      },
    });
  }
  if (conv.status === "PENDING" && promotePendingToOpen) {
    return prisma.conversation.update({
      where: { id: conv.id },
      data: { status: "OPEN", updatedAt: new Date() },
    });
  }
  return triageOpenUnassignedForAgentBot(conv, activeConversationStatus);
}

/**
 * Resposta após envio de template numa conversa RESOLVED: reutilizar a mesma thread.
 */
async function findResolvedConversationWithRecentTemplate(
  params: {
    organizationId: string;
    contactId: string;
    inboxId: string;
  },
  db: DbClient = prisma,
) {
  const since = new Date(Date.now() - TEMPLATE_REPLY_REOPEN_MS);
  return db.conversation.findFirst({
    where: {
      organizationId: params.organizationId,
      contactId: params.contactId,
      inboxId: params.inboxId,
      status: "RESOLVED",
      messages: {
        some: {
          direction: "OUTBOUND",
          type: "TEMPLATE",
          createdAt: { gte: since },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export type EnsureConversationForChannelInboxParams = {
  organizationId: string;
  contactId: string;
  inboxId: string;
  lockSingleConversation: boolean;
  activeConversationStatus: "OPEN" | "PENDING";
  createDefaults: { status: "OPEN" | "PENDING"; assignedToId?: string | null };
};

/**
 * Conversa numa caixa explícita (canais API / widget / SMS / Telegram / …).
 * Escopo por `inboxId` para o mesmo contacto poder existir em várias caixas.
 */
export async function ensureConversationForChannelInbox(
  params: EnsureConversationForChannelInboxParams,
): Promise<Conversation> {
  return ensureConversationForChannelInboxWithDb(params, prisma);
}

async function ensureConversationForChannelInboxWithDb(
  params: EnsureConversationForChannelInboxParams,
  db: DbClient,
): Promise<Conversation> {
  const {
    organizationId,
    contactId,
    inboxId,
    lockSingleConversation,
    activeConversationStatus,
    createDefaults,
  } = params;

  const promotePendingToOpen = activeConversationStatus === "OPEN";

  if (lockSingleConversation) {
    let conv = await db.conversation.findFirst({
      where: { organizationId, contactId, inboxId },
      orderBy: { updatedAt: "desc" },
    });
    if (conv) {
      if (conv.status === "RESOLVED") {
        return db.conversation.update({
          where: { id: conv.id },
          data: reopenResolvedConversationData(activeConversationStatus),
        });
      }
      if (conv.status === "PENDING" && promotePendingToOpen) {
        return db.conversation.update({
          where: { id: conv.id },
          data: { status: "OPEN", updatedAt: new Date() },
        });
      }
      return triageOpenUnassignedForAgentBot(conv, activeConversationStatus, db);
    }
    return db.conversation.create({
      data: {
        organizationId,
        inboxId,
        contactId,
        status: createDefaults.status,
        assignedToId: createDefaults.assignedToId ?? undefined,
      },
    });
  }

  let conv = await db.conversation.findFirst({
    where: { organizationId, contactId, inboxId, status: { not: "RESOLVED" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conv) {
    const templateThread = await findResolvedConversationWithRecentTemplate(
      {
        organizationId,
        contactId,
        inboxId,
      },
      db,
    );
    if (templateThread) {
      return db.conversation.update({
        where: { id: templateThread.id },
        data: reopenResolvedConversationData(activeConversationStatus),
      });
    }
    return db.conversation.create({
      data: {
        organizationId,
        inboxId,
        contactId,
        status: createDefaults.status,
        assignedToId: createDefaults.assignedToId ?? undefined,
      },
    });
  }
  if (conv.status === "PENDING" && promotePendingToOpen) {
    return db.conversation.update({
      where: { id: conv.id },
      data: { status: "OPEN", updatedAt: new Date() },
    });
  }
  return triageOpenUnassignedForAgentBot(conv, activeConversationStatus, db);
}

const INBOUND_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Fecha threads PENDING duplicadas criadas em paralelo (ex.: screen-pop + webhook Wavoip).
 */
export async function dedupeParallelInboundConversations(input: {
  organizationId: string;
  contactId: string;
  inboxId: string;
  keepConversationId: string;
}): Promise<number> {
  const since = new Date(Date.now() - INBOUND_DEDUPE_WINDOW_MS);
  const result = await prisma.conversation.updateMany({
    where: {
      organizationId: input.organizationId,
      contactId: input.contactId,
      inboxId: input.inboxId,
      id: { not: input.keepConversationId },
      status: "PENDING",
      createdAt: { gte: since },
    },
    data: { status: "RESOLVED", updatedAt: new Date() },
  });
  return result.count;
}

/**
 * Chamadas de voz (Wavoip/3CX/Nvoip): uma conversa por contacto+caixa, transação serializável anti-corrida.
 */
export async function ensureInboundCallConversation(input: {
  organizationId: string;
  contactId: string;
  inboxId: string;
  activeConversationStatus?: "OPEN" | "PENDING";
  assignedToId?: string | null;
}): Promise<Conversation> {
  const activeConversationStatus = input.activeConversationStatus ?? "PENDING";
  const params: EnsureConversationForChannelInboxParams = {
    organizationId: input.organizationId,
    contactId: input.contactId,
    inboxId: input.inboxId,
    lockSingleConversation: true,
    activeConversationStatus,
    createDefaults: {
      status: activeConversationStatus,
      assignedToId: input.assignedToId ?? null,
    },
  };

  const runTx = () =>
    prisma.$transaction(
      (tx) => ensureConversationForChannelInboxWithDb(params, tx),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 8000,
        timeout: 15000,
      },
    );

  let conv: Conversation;
  try {
    conv = await runTx();
  } catch {
    conv = await runTx();
  }

  await dedupeParallelInboundConversations({
    organizationId: input.organizationId,
    contactId: input.contactId,
    inboxId: input.inboxId,
    keepConversationId: conv.id,
  });

  return conv;
}
