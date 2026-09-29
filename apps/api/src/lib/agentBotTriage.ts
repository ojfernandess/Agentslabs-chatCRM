import type { Bot } from "@prisma/client";
import type { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import {
  getCachedInboxWithAgentBot,
  getCachedOrganizationSettings,
} from "./requestLookupCache.js";
import {
  getCachedAgentBotDispatchContext,
  setCachedAgentBotDispatchContext,
} from "./agentBotDispatchContextCache.js";
import { config } from "../config.js";

export type AgentBotDispatchContext = {
  agentBotId: string;
  agentBot: Bot;
};

function isNativeManagedBotConfig(config: unknown): boolean {
  if (config == null || typeof config !== "object") return false;
  return (config as { automationManagedByOpenConduit?: unknown }).automationManagedByOpenConduit === true;
}

/**
 * A partir da linha de Settings (e include opcional do Bot), obtém contexto de envio se o bot estiver operacional.
 * Recarrega `Bot` por id quando o include veio vazio ou desactualizado.
 */
export async function resolveAgentBotFromOrgSettingsRow(
  organizationId: string,
  row: { agentBotId: string | null; agentBot: Bot | null } | null | undefined,
): Promise<AgentBotDispatchContext | null> {
  if (!row?.agentBotId) return null;
  let bot = row.agentBot;
  if (!bot || bot.id !== row.agentBotId) {
    bot = await prisma.bot.findFirst({
      where: { id: row.agentBotId, organizationId },
    });
  }
  if (!bot?.isActive) return null;
  const hasExternalWebhook = Boolean(bot.webhookUrl?.trim());
  const nativeManaged = isNativeManagedBotConfig(bot.config);
  if (!hasExternalWebhook && !nativeManaged) return null;
  return { agentBotId: row.agentBotId, agentBot: bot };
}

/** Caixa por defeito ou a mais antiga (sem importar `defaultInbox` para evitar ciclo com channelInboxIngest). */
async function findPreferredInboxIdForOrgTriage(organizationId: string): Promise<string | null> {
  const d = await prisma.inbox.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (d) return d.id;
  const first = await prisma.inbox.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

/**
 * Bot da caixa (`Inbox.agentBotId`) tem prioridade; se não houver ou estiver inactivo, usa `Settings.agentBotId`.
 * Caixas EMAIL sem bot explícito ficam só com atendimento humano (sem herdar bot de outras caixas).
 */
export async function getAgentBotDispatchContextForInbox(
  organizationId: string,
  inboxId: string,
): Promise<AgentBotDispatchContext | null> {
  if (config.agentBotDispatchContextCacheTtlMs > 0) {
    const cached = getCachedAgentBotDispatchContext(organizationId, inboxId);
    if (cached !== undefined) return cached;
  }

  const inbox = await getCachedInboxWithAgentBot(organizationId, inboxId);
  if (!inbox) {
    if (config.agentBotDispatchContextCacheTtlMs > 0) {
      setCachedAgentBotDispatchContext(organizationId, inboxId, null);
    }
    return null;
  }

  let resolved: AgentBotDispatchContext | null = null;

  if (inbox.agentBotId) {
    resolved = await resolveAgentBotFromOrgSettingsRow(organizationId, {
      agentBotId: inbox.agentBotId,
      agentBot: inbox.agentBot,
    });
  }

  if (!resolved && inbox.channelType !== "EMAIL") {
    const settings = await getCachedOrganizationSettings(organizationId);
    resolved = await resolveAgentBotFromOrgSettingsRow(organizationId, settings);
  }

  if (config.agentBotDispatchContextCacheTtlMs > 0) {
    setCachedAgentBotDispatchContext(organizationId, inboxId, resolved);
  }
  return resolved;
}

/** Compat: usa a caixa preferida da org (defeito ou primeira) e aplica a mesma regra caixa → settings. */
export async function getAgentBotDispatchContext(organizationId: string): Promise<AgentBotDispatchContext | null> {
  const inboxId = await findPreferredInboxIdForOrgTriage(organizationId);
  if (inboxId) return getAgentBotDispatchContextForInbox(organizationId, inboxId);
  const settings = await getCachedOrganizationSettings(organizationId);
  return resolveAgentBotFromOrgSettingsRow(organizationId, settings);
}

export function inboxChannelSupportsAgentBotTriage(_channelType: InboxChannelType): boolean {
  return true;
}

export function computeAgentBotTriageActive(
  ctx: AgentBotDispatchContext | null,
  inboxChannelType: InboxChannelType,
): boolean {
  if (!ctx) return false;
  return inboxChannelSupportsAgentBotTriage(inboxChannelType);
}

/** Caixas em que o bot de canal está operacional (para filtrar fila do bot). */
export async function listInboxIdsWithAgentBotTriage(
  organizationId: string,
  inboxIds?: string[],
): Promise<string[]> {
  const inboxes = await prisma.inbox.findMany({
    where: {
      organizationId,
      ...(inboxIds && inboxIds.length > 0 ? { id: { in: inboxIds } } : {}),
    },
    select: { id: true, channelType: true },
  });
  const active: string[] = [];
  for (const inbox of inboxes) {
    const ctx = await getAgentBotDispatchContextForInbox(organizationId, inbox.id);
    if (computeAgentBotTriageActive(ctx, inbox.channelType)) {
      active.push(inbox.id);
    }
  }
  return active;
}
