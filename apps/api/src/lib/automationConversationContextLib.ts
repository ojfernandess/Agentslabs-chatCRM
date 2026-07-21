import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type FollowUpCampaignContextState = {
  campaignId: string;
  campaignName: string;
  messageType: "TEXT" | "TEMPLATE";
  templateId?: string | null;
  templateName?: string | null;
  outboundMessageId: string;
  outboundBody: string | null;
  sentAt: string;
};

export type AutomationContextState = {
  followUpCampaign?: FollowUpCampaignContextState;
  nativeTurn?: {
    lastInboundMessageId: string;
    lastInboundAt: string;
    lastPreview: string;
  };
  /** Última ronda de ferramentas do agente nativo (auditoria e continuidade entre turnos). */
  lastNativeToolRound?: {
    at: string;
    toolCount: number;
    tools: Array<{ name: string; ok: boolean; preview: string }>;
    resultDeliveredToCustomer: boolean;
  };
};

function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** Compatível com estado legado `{ source: "native_agent", ... }`. */
export function parseAutomationContextState(raw: unknown): AutomationContextState {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;

  if (o.followUpCampaign && typeof o.followUpCampaign === "object") {
    const fu = o.followUpCampaign as Record<string, unknown>;
    const followUpCampaign: FollowUpCampaignContextState = {
      campaignId: String(fu.campaignId ?? ""),
      campaignName: String(fu.campaignName ?? ""),
      messageType: fu.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
      templateId: typeof fu.templateId === "string" ? fu.templateId : null,
      templateName: typeof fu.templateName === "string" ? fu.templateName : null,
      outboundMessageId: String(fu.outboundMessageId ?? ""),
      outboundBody: typeof fu.outboundBody === "string" ? fu.outboundBody : null,
      sentAt: String(fu.sentAt ?? ""),
    };
    const nativeTurn =
      o.nativeTurn && typeof o.nativeTurn === "object"
        ? {
            lastInboundMessageId: String((o.nativeTurn as Record<string, unknown>).lastInboundMessageId ?? ""),
            lastInboundAt: String((o.nativeTurn as Record<string, unknown>).lastInboundAt ?? ""),
            lastPreview: String((o.nativeTurn as Record<string, unknown>).lastPreview ?? ""),
          }
        : undefined;
    const lastNativeToolRound = parseLastNativeToolRound(o.lastNativeToolRound);
    return {
      followUpCampaign,
      ...(nativeTurn ? { nativeTurn } : {}),
      ...(lastNativeToolRound ? { lastNativeToolRound } : {}),
    };
  }

  if (o.source === "follow_up_campaign") {
    return {
      followUpCampaign: {
        campaignId: String(o.campaignId ?? ""),
        campaignName: String(o.campaignName ?? ""),
        messageType: o.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
        templateId: typeof o.templateId === "string" ? o.templateId : null,
        templateName: typeof o.templateName === "string" ? o.templateName : null,
        outboundMessageId: String(o.outboundMessageId ?? ""),
        outboundBody: typeof o.outboundBody === "string" ? o.outboundBody : null,
        sentAt: String(o.sentAt ?? ""),
      },
    };
  }

  if (o.source === "native_agent") {
    return {
      nativeTurn: {
        lastInboundMessageId: String(o.lastInboundMessageId ?? ""),
        lastInboundAt: String(o.lastInboundAt ?? ""),
        lastPreview: String(o.lastPreview ?? ""),
      },
    };
  }

  return {};
}

function parseLastNativeToolRound(raw: unknown): AutomationContextState["lastNativeToolRound"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const toolsRaw = Array.isArray(o.tools) ? o.tools : [];
  const tools = toolsRaw
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const t = row as Record<string, unknown>;
      const name = typeof t.name === "string" ? t.name.trim() : "";
      if (!name) return null;
      return {
        name: name.slice(0, 120),
        ok: t.ok === true,
        preview: typeof t.preview === "string" ? t.preview.slice(0, 500) : "",
      };
    })
    .filter((x): x is { name: string; ok: boolean; preview: string } => x != null);
  if (!tools.length && typeof o.at !== "string") return undefined;
  return {
    at: typeof o.at === "string" ? o.at : new Date().toISOString(),
    toolCount: typeof o.toolCount === "number" ? o.toolCount : tools.length,
    tools,
    resultDeliveredToCustomer: o.resultDeliveredToCustomer === true,
  };
}

export function buildFollowUpCampaignPromptBlock(ctx: FollowUpCampaignContextState): string {
  const label =
    ctx.messageType === "TEMPLATE"
      ? `modelo WhatsApp${ctx.templateName ? ` «${ctx.templateName}»` : ""}`
      : "mensagem de texto";
  const body = (ctx.outboundBody ?? "").trim() || "(sem texto visível)";
  return (
    "\n\n[OpenConduit — resposta a campanha de follow-up]\n" +
    `A organização enviou uma campanha de follow-up («${ctx.campaignName}») com ${label}.\n` +
    "Mensagem enviada ao cliente (trate a próxima fala do cliente como continuação / resposta a este envio):\n" +
    `«${body.slice(0, 2000)}»\n` +
    "Não presuma contexto de atendimentos anteriores já encerrados; foque neste envio e no pedido actual do cliente."
  );
}

export function buildWebhookConversationContext(
  state: AutomationContextState,
  lastClearedAt: Date | null,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (state.followUpCampaign) {
    out.follow_up_campaign = state.followUpCampaign;
  }
  if (lastClearedAt) {
    out.last_cleared_at = lastClearedAt.toISOString();
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Limpa memória do agente (estado + corte de histórico nativo). */
export async function clearAutomationConversationContext(
  organizationId: string,
  conversationId: string,
): Promise<void> {
  const clearedAt = new Date();
  const updated = await prisma.automationConversationContext.updateMany({
    where: { conversationId, organizationId },
    data: { state: asJson({}), lastClearedAt: clearedAt },
  });
  if (updated.count > 0) return;

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { id: true },
  });
  if (!conv) return;

  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { agentBotId: true },
  });
  const botId = settings?.agentBotId;
  if (!botId) return;

  await prisma.automationConversationContext.upsert({
    where: { conversationId },
    create: {
      organizationId,
      conversationId,
      botId,
      state: asJson({}),
      lastClearedAt: clearedAt,
    },
    update: { state: asJson({}), lastClearedAt: clearedAt, botId },
  });
}

export async function loadAutomationConversationContext(conversationId: string): Promise<{
  state: AutomationContextState;
  lastClearedAt: Date | null;
}> {
  const row = await prisma.automationConversationContext.findUnique({
    where: { conversationId },
    select: { state: true, lastClearedAt: true },
  });
  return {
    state: parseAutomationContextState(row?.state),
    lastClearedAt: row?.lastClearedAt ?? null,
  };
}

/** Após envio de follow-up: novo contexto para o bot e histórico nativo reiniciado. */
export async function seedFollowUpCampaignAutomationContext(params: {
  organizationId: string;
  conversationId: string;
  botId: string;
  campaign: { id: string; name: string };
  outboundMessage: { id: string; body: string | null; type: string };
  messageType: "TEXT" | "TEMPLATE";
  templateId?: string | null;
  templateName?: string | null;
}): Promise<void> {
  const clearedAt = new Date();
  const followUpCampaign: FollowUpCampaignContextState = {
    campaignId: params.campaign.id,
    campaignName: params.campaign.name,
    messageType: params.messageType,
    templateId: params.templateId ?? null,
    templateName: params.templateName ?? null,
    outboundMessageId: params.outboundMessage.id,
    outboundBody: params.outboundMessage.body,
    sentAt: clearedAt.toISOString(),
  };

  await prisma.automationConversationContext.upsert({
    where: { conversationId: params.conversationId },
    create: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      botId: params.botId,
      state: asJson({ followUpCampaign }),
      lastClearedAt: clearedAt,
    },
    update: {
      botId: params.botId,
      state: asJson({ followUpCampaign }),
      lastClearedAt: clearedAt,
    },
  });
}

export async function mergeNativeTurnAutomationContext(params: {
  organizationId: string;
  conversationId: string;
  botId: string;
  message: { id: string; createdAt: Date; body: string | null };
}): Promise<void> {
  const existing = await loadAutomationConversationContext(params.conversationId);
  const preview = (params.message.body ?? "").trim().slice(0, 500);
  const state: AutomationContextState = {
    ...(existing.state.followUpCampaign ? { followUpCampaign: existing.state.followUpCampaign } : {}),
    ...(existing.state.lastNativeToolRound ? { lastNativeToolRound: existing.state.lastNativeToolRound } : {}),
    nativeTurn: {
      lastInboundMessageId: params.message.id,
      lastInboundAt: params.message.createdAt.toISOString(),
      lastPreview: preview,
    },
  };

  await prisma.automationConversationContext.upsert({
    where: { conversationId: params.conversationId },
    create: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      botId: params.botId,
      state: asJson(state),
      lastClearedAt: existing.lastClearedAt,
    },
    update: {
      botId: params.botId,
      state: asJson(state),
    },
  });
}

export async function mergeNativeToolRoundAutomationContext(params: {
  organizationId: string;
  conversationId: string;
  botId: string;
  toolRound: NonNullable<AutomationContextState["lastNativeToolRound"]>;
}): Promise<void> {
  const existing = await loadAutomationConversationContext(params.conversationId);
  const state: AutomationContextState = {
    ...(existing.state.followUpCampaign ? { followUpCampaign: existing.state.followUpCampaign } : {}),
    ...(existing.state.nativeTurn ? { nativeTurn: existing.state.nativeTurn } : {}),
    lastNativeToolRound: params.toolRound,
  };

  await prisma.automationConversationContext.upsert({
    where: { conversationId: params.conversationId },
    create: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      botId: params.botId,
      state: asJson(state),
      lastClearedAt: existing.lastClearedAt,
    },
    update: {
      botId: params.botId,
      state: asJson(state),
    },
  });
}
