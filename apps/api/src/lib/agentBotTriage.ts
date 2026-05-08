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

export async function getAgentBotDispatchContext(organizationId: string): Promise<AgentBotDispatchContext | null> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });
  return resolveAgentBotFromOrgSettingsRow(organizationId, settings);
}

/** O mesmo bot org-wide aplica-se às caixas ligadas a ingest / WhatsApp na app. */
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
