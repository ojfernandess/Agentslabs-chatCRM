import type { Bot } from "@prisma/client";
import type { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";

export type AgentBotDispatchContext = {
  agentBotId: string;
  agentBot: Bot;
};

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
  if (!bot?.isActive || !bot.webhookUrl?.trim()) return null;
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
 */
export async function getAgentBotDispatchContextForInbox(
  organizationId: string,
  inboxId: string,
): Promise<AgentBotDispatchContext | null> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId },
    include: { agentBot: true },
  });
  if (inbox?.agentBotId) {
    const ctx = await resolveAgentBotFromOrgSettingsRow(organizationId, {
      agentBotId: inbox.agentBotId,
      agentBot: inbox.agentBot,
    });
    if (ctx) return ctx;
  }
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });
  const fromSettings = await resolveAgentBotFromOrgSettingsRow(organizationId, settings);
  if (fromSettings) return fromSettings;

  // Fallback: if a bot is linked in any inbox, use it even when the current
  // conversation landed in another inbox (common during provider/inbox migration).
  const anyInboxWithBot = await prisma.inbox.findFirst({
    where: { organizationId, agentBotId: { not: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { agentBot: true },
  });
  if (!anyInboxWithBot?.agentBotId) return null;
  return resolveAgentBotFromOrgSettingsRow(organizationId, {
    agentBotId: anyInboxWithBot.agentBotId,
    agentBot: anyInboxWithBot.agentBot,
  });
}

/** Compat: usa a caixa preferida da org (defeito ou primeira) e aplica a mesma regra caixa → settings. */
export async function getAgentBotDispatchContext(organizationId: string): Promise<AgentBotDispatchContext | null> {
  const inboxId = await findPreferredInboxIdForOrgTriage(organizationId);
  if (inboxId) return getAgentBotDispatchContextForInbox(organizationId, inboxId);
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });
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
