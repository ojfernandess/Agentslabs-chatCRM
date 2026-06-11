import { prisma } from "../db.js";

export type CrmFlowContext = Record<string, unknown>;

/** Enriquece payload com dados de contacto/conversa/deal para condições e variáveis. */
export async function hydrateCrmFlowContext(
  organizationId: string,
  payload: CrmFlowContext,
): Promise<CrmFlowContext> {
  const ctx: CrmFlowContext = { ...payload, organizationId };

  const contactId = payload.contactId as string | undefined;
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      include: {
        tags: { include: { tag: { select: { id: true, name: true } } } },
        pipelineStage: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
      },
    });
    if (contact) {
      ctx.nome = contact.name;
      ctx.name = contact.name;
      ctx.telefone = contact.phone;
      ctx.phone = contact.phone;
      ctx.email = contact.email ?? "";
      ctx.empresa = contact.account?.name ?? "";
      ctx.company = contact.account?.name ?? "";
      ctx.etapa = contact.pipelineStage?.name ?? "";
      ctx.pipelineStageId = contact.pipelineStageId ?? "";
      ctx.responsavel = contact.assignedTo?.name ?? "";
      ctx.assignedToId = contact.assignedToId ?? "";
      ctx.tagIds = contact.tags.map((t) => t.tagId);
      ctx.tags = contact.tags.map((t) => t.tag.name).join(", ");
    }
  }

  const conversationId = payload.conversationId as string | undefined;
  if (conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: {
        inbox: { select: { id: true, name: true, channelType: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    if (conv) {
      ctx.inboxId = conv.inboxId;
      ctx.inboxName = conv.inbox.name;
      ctx.channel = conv.inbox.channelType;
      ctx.canal = conv.inbox.channelType;
      ctx.conversationStatus = conv.status;
      if (!ctx.contactId) ctx.contactId = conv.contactId;
      if (!ctx.assignedToId && conv.assignedToId) {
        ctx.assignedToId = conv.assignedToId;
        ctx.responsavel = conv.assignedTo?.name ?? "";
      }
    }
  }

  const dealId = payload.dealId as string | undefined;
  if (dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, organizationId },
      include: { stage: { select: { id: true, name: true } } },
    });
    if (deal) {
      ctx.dealId = deal.id;
      ctx.dealTitle = deal.name;
      ctx.dealValue = deal.amountCents / 100;
      ctx.valor = deal.amountCents / 100;
      ctx.etapa = deal.stage?.name ?? ctx.etapa;
      ctx.pipelineStageId = deal.stageId;
      if (!ctx.contactId && deal.primaryContactId) ctx.contactId = deal.primaryContactId;
    }
  }

  return ctx;
}
