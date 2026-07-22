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

/** Identificadores e flags estáveis reutilizáveis entre tools/turnos (genérico para qualquer automação). */
export type AutomationFlowSlots = Record<string, string | number | boolean>;

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
  /** Slots de fluxo (IDs, flags, URLs) persistidos após tools bem-sucedidas. */
  flowSlots?: AutomationFlowSlots;
  /** Etapa livre do fluxo (ex.: "awaiting_document", "uploaded_selfie") — opcional. */
  flowStep?: string;
};

function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

function parseNativeTurn(raw: unknown): AutomationContextState["nativeTurn"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  return {
    lastInboundMessageId: String(o.lastInboundMessageId ?? ""),
    lastInboundAt: String(o.lastInboundAt ?? ""),
    lastPreview: String(o.lastPreview ?? ""),
  };
}

export function parseFlowSlots(raw: unknown): AutomationFlowSlots | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: AutomationFlowSlots = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key || key.length > 120) continue;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out[key] = s.slice(0, 2000);
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = v;
    } else if (typeof v === "boolean") {
      out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Compatível com estado legado `{ source: "native_agent", ... }`. */
export function parseAutomationContextState(raw: unknown): AutomationContextState {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;

  // Formato canónico: campos de topo (follow-up, nativeTurn, tool round, flowSlots) — não exigir followUp.
  if (
    o.followUpCampaign ||
    o.nativeTurn ||
    o.lastNativeToolRound ||
    o.flowSlots ||
    typeof o.flowStep === "string" ||
    o.source === "follow_up_campaign" ||
    o.source === "native_agent"
  ) {
    const state: AutomationContextState = {};

    if (o.followUpCampaign && typeof o.followUpCampaign === "object") {
      const fu = o.followUpCampaign as Record<string, unknown>;
      state.followUpCampaign = {
        campaignId: String(fu.campaignId ?? ""),
        campaignName: String(fu.campaignName ?? ""),
        messageType: fu.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
        templateId: typeof fu.templateId === "string" ? fu.templateId : null,
        templateName: typeof fu.templateName === "string" ? fu.templateName : null,
        outboundMessageId: String(fu.outboundMessageId ?? ""),
        outboundBody: typeof fu.outboundBody === "string" ? fu.outboundBody : null,
        sentAt: String(fu.sentAt ?? ""),
      };
    } else if (o.source === "follow_up_campaign") {
      state.followUpCampaign = {
        campaignId: String(o.campaignId ?? ""),
        campaignName: String(o.campaignName ?? ""),
        messageType: o.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
        templateId: typeof o.templateId === "string" ? o.templateId : null,
        templateName: typeof o.templateName === "string" ? o.templateName : null,
        outboundMessageId: String(o.outboundMessageId ?? ""),
        outboundBody: typeof o.outboundBody === "string" ? o.outboundBody : null,
        sentAt: String(o.sentAt ?? ""),
      };
    }

    const nativeTurn =
      parseNativeTurn(o.nativeTurn) ??
      (o.source === "native_agent"
        ? {
            lastInboundMessageId: String(o.lastInboundMessageId ?? ""),
            lastInboundAt: String(o.lastInboundAt ?? ""),
            lastPreview: String(o.lastPreview ?? ""),
          }
        : undefined);
    if (nativeTurn) state.nativeTurn = nativeTurn;

    const lastNativeToolRound = parseLastNativeToolRound(o.lastNativeToolRound);
    if (lastNativeToolRound) state.lastNativeToolRound = lastNativeToolRound;

    const flowSlots = parseFlowSlots(o.flowSlots);
    if (flowSlots) state.flowSlots = flowSlots;

    if (typeof o.flowStep === "string" && o.flowStep.trim()) {
      state.flowStep = o.flowStep.trim().slice(0, 120);
    }

    return state;
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

/** Prompt com estado de fluxo + última ronda de tools (reutilização de IDs/flags). */
export function buildNativeFlowStatePromptBlock(state: AutomationContextState): string {
  const parts: string[] = [];
  if (state.flowStep?.trim()) {
    parts.push(`Etapa actual do fluxo: ${state.flowStep.trim()}`);
  }
  const slots = state.flowSlots;
  if (slots && Object.keys(slots).length > 0) {
    const lines = Object.entries(slots)
      .slice(0, 40)
      .map(([k, v]) => `- ${k}: ${String(v).slice(0, 200)}`);
    parts.push("Valores já obtidos nesta conversa (reutilize como argumentos das tools quando o schema o exigir):\n" + lines.join("\n"));
  }
  const round = state.lastNativeToolRound;
  if (round && round.tools.length > 0) {
    const toolLines = round.tools
      .slice(0, 8)
      .map((t) => `- ${t.name}: ${t.ok ? "ok" : "falhou"} — ${t.preview.slice(0, 180)}`);
    parts.push(
      `Última ronda de ferramentas (${round.at}):\n` +
        toolLines.join("\n") +
        "\nSe uma tool anterior já devolveu IDs/URLs, reutilize-os; não peça ao cliente o que já está no estado.",
    );
  }
  if (parts.length === 0) return "";
  return "\n\n[OpenConduit — estado do fluxo da conversa]\n" + parts.join("\n\n");
}

const FLOW_SLOT_SKIP_KEYS = new Set([
  "pathParams",
  "query",
  "headers",
  "body",
  "sampleContext",
  "attachmentBase64",
  "mediaBase64",
  "attachmentUrl",
  "mediaUrl",
  "data",
  "file",
  "photo",
  "image",
]);

/** Extrai slots estáveis de argumentos LLM (escalares) e de respostas JSON de tools. */
export function extractFlowSlotsFromToolExchange(input: {
  llmArgs?: Record<string, unknown>;
  responseText?: string;
  ok?: boolean;
}): AutomationFlowSlots {
  const out: AutomationFlowSlots = {};

  const takeScalar = (key: string, val: unknown, depth = 0) => {
    if (depth > 2 || FLOW_SLOT_SKIP_KEYS.has(key)) return;
    if (typeof val === "string") {
      const s = val.trim();
      if (!s || s.length > 500) return;
      // Evitar base64 / blobs
      if (s.length > 120 && /^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 200) return;
      out[key] = s;
    } else if (typeof val === "number" && Number.isFinite(val)) {
      out[key] = val;
    } else if (typeof val === "boolean") {
      out[key] = val;
    } else if (val && typeof val === "object" && !Array.isArray(val) && depth < 1) {
      for (const [ck, cv] of Object.entries(val as Record<string, unknown>)) {
        if (typeof cv === "string" || typeof cv === "number" || typeof cv === "boolean") {
          takeScalar(ck, cv, depth + 1);
        }
      }
    }
  };

  if (input.llmArgs) {
    for (const [k, v] of Object.entries(input.llmArgs)) {
      takeScalar(k, v, 0);
    }
    const pathParams = input.llmArgs.pathParams;
    if (pathParams && typeof pathParams === "object" && !Array.isArray(pathParams)) {
      for (const [k, v] of Object.entries(pathParams as Record<string, unknown>)) {
        takeScalar(k, v, 0);
      }
    }
  }

  if (input.ok && input.responseText?.trim()) {
    try {
      const parsed = JSON.parse(input.responseText) as unknown;
      const root =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      if (root) {
        const nested =
          root.data && typeof root.data === "object" && !Array.isArray(root.data)
            ? (root.data as Record<string, unknown>)
            : root.result && typeof root.result === "object" && !Array.isArray(root.result)
              ? (root.result as Record<string, unknown>)
              : root;
        for (const [k, v] of Object.entries(nested)) {
          const keyLower = k.toLowerCase();
          const looksLikeId =
            keyLower === "id" ||
            keyLower.endsWith("id") ||
            keyLower.endsWith("url") ||
            keyLower.includes("localizer") ||
            keyLower.includes("token") ||
            keyLower.includes("reference") ||
            keyLower.includes("code");
          if (looksLikeId) takeScalar(k, v, 0);
        }
      }
    } catch {
      /* ignore non-JSON */
    }
  }

  return out;
}

function mergeStatePreserve(existing: AutomationContextState, patch: Partial<AutomationContextState>): AutomationContextState {
  return {
    ...(existing.followUpCampaign ? { followUpCampaign: existing.followUpCampaign } : {}),
    ...(patch.followUpCampaign ? { followUpCampaign: patch.followUpCampaign } : {}),
    ...(existing.nativeTurn || patch.nativeTurn
      ? { nativeTurn: patch.nativeTurn ?? existing.nativeTurn }
      : {}),
    ...(existing.lastNativeToolRound || patch.lastNativeToolRound
      ? { lastNativeToolRound: patch.lastNativeToolRound ?? existing.lastNativeToolRound }
      : {}),
    ...(existing.flowSlots || patch.flowSlots
      ? {
          flowSlots: {
            ...(existing.flowSlots ?? {}),
            ...(patch.flowSlots ?? {}),
          },
        }
      : {}),
    ...(existing.flowStep || patch.flowStep
      ? { flowStep: patch.flowStep ?? existing.flowStep }
      : {}),
  };
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
  options?: { scope?: "conversation" | "contact" },
): Promise<{ clearedConversationIds: string[] }> {
  const clearedAt = new Date();
  const scope = options?.scope ?? "conversation";

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { id: true, contactId: true },
  });
  if (!conv) return { clearedConversationIds: [] };

  const conversationIds =
    scope === "contact"
      ? (
          await prisma.conversation.findMany({
            where: { organizationId, contactId: conv.contactId },
            select: { id: true },
          })
        ).map((row) => row.id)
      : [conv.id];

  if (conversationIds.length === 0) return { clearedConversationIds: [] };

  await prisma.automationConversationContext.updateMany({
    where: { organizationId, conversationId: { in: conversationIds } },
    data: { state: asJson({}), lastClearedAt: clearedAt },
  });

  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { agentBotId: true },
  });
  const botId = settings?.agentBotId;
  if (!botId) {
    return { clearedConversationIds: conversationIds };
  }

  const existingRows = await prisma.automationConversationContext.findMany({
    where: { organizationId, conversationId: { in: conversationIds } },
    select: { conversationId: true },
  });
  const existingIds = new Set(existingRows.map((row) => row.conversationId));
  const missingIds = conversationIds.filter((id) => !existingIds.has(id));

  if (missingIds.length > 0) {
    await prisma.automationConversationContext.createMany({
      data: missingIds.map((id) => ({
        organizationId,
        conversationId: id,
        botId,
        state: asJson({}),
        lastClearedAt: clearedAt,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.automationConversationContext.updateMany({
    where: { organizationId, conversationId: { in: conversationIds } },
    data: { state: asJson({}), lastClearedAt: clearedAt, botId },
  });

  return { clearedConversationIds: conversationIds };
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
  const state = mergeStatePreserve(existing.state, {
    nativeTurn: {
      lastInboundMessageId: params.message.id,
      lastInboundAt: params.message.createdAt.toISOString(),
      lastPreview: preview,
    },
  });

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
  flowSlots?: AutomationFlowSlots;
  flowStep?: string;
}): Promise<void> {
  const existing = await loadAutomationConversationContext(params.conversationId);
  const state = mergeStatePreserve(existing.state, {
    lastNativeToolRound: params.toolRound,
    ...(params.flowSlots ? { flowSlots: params.flowSlots } : {}),
    ...(params.flowStep ? { flowStep: params.flowStep } : {}),
  });

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

/** Acrescenta/actualiza slots de fluxo sem apagar o resto do estado. */
export async function mergeFlowSlotsAutomationContext(params: {
  organizationId: string;
  conversationId: string;
  botId: string;
  flowSlots: AutomationFlowSlots;
  flowStep?: string;
}): Promise<AutomationFlowSlots> {
  const existing = await loadAutomationConversationContext(params.conversationId);
  const state = mergeStatePreserve(existing.state, {
    flowSlots: params.flowSlots,
    ...(params.flowStep ? { flowStep: params.flowStep } : {}),
  });
  const mergedSlots = state.flowSlots ?? {};

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

  return mergedSlots;
}
