import type { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";

export function formatAgentPrefix(label: string, channelType: InboxChannelType): string {
  if (channelType === "WHATSAPP") return `*${label}*`;
  if (channelType === "TELEGRAM") return `<b>${label}</b>`;
  return `${label}:`;
}

/**
 * Prefixo com o nome do atendente — só para envio ao canal externo.
 * O corpo guardado na BD mantém-se sem este prefixo para o painel não duplicar o cabeçalho.
 */
async function userCanShowAgentNameInOrg(
  userId: string,
  organizationId: string,
): Promise<{ showAgentNameInChat: boolean; label: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      displayName: true,
      showAgentNameInChat: true,
      organizationId: true,
      role: true,
    },
  });
  if (!user?.showAgentNameInChat) return null;

  const label = user.displayName?.trim() || user.name?.trim();
  if (!label) return null;

  if (user.role === "SUPER_ADMIN" || user.organizationId === organizationId) {
    return { showAgentNameInChat: true, label };
  }

  const [inInbox, inTeam] = await Promise.all([
    prisma.inboxMember.findFirst({
      where: { userId, inbox: { organizationId } },
      select: { id: true },
    }),
    prisma.teamMember.findFirst({
      where: { userId, team: { organizationId } },
      select: { id: true },
    }),
  ]);
  if (!inInbox && !inTeam) return null;

  return { showAgentNameInChat: true, label };
}

async function agentNamePrefixForUser(
  organizationId: string,
  userId: string,
  channelType: InboxChannelType,
): Promise<string | null> {
  const row = await userCanShowAgentNameInOrg(userId, organizationId);
  if (!row) return null;
  return formatAgentPrefix(row.label, channelType);
}

async function userLabelInOrg(userId: string, organizationId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, displayName: true, organizationId: true, role: true },
  });
  if (!user) return null;
  const label = user.displayName?.trim() || user.name?.trim();
  if (!label) return null;
  if (user.role === "SUPER_ADMIN" || user.organizationId === organizationId) return label;
  const [inInbox, inTeam] = await Promise.all([
    prisma.inboxMember.findFirst({
      where: { userId, inbox: { organizationId } },
      select: { id: true },
    }),
    prisma.teamMember.findFirst({
      where: { userId, team: { organizationId } },
      select: { id: true },
    }),
  ]);
  if (!inInbox && !inTeam) return null;
  return label;
}

function applyPrefixToBody(prefix: string, body: string | null | undefined): string {
  const trimmed = (body ?? "").trim();
  if (trimmed.startsWith(prefix)) return trimmed;
  return trimmed ? `${prefix}\n\n${trimmed}` : prefix;
}

/** Prefixo com o nome do atendente criador, independente de showAgentNameInChat. */
export async function prefixOutboundBodyForcedAgentName(
  organizationId: string,
  userId: string,
  body: string | null | undefined,
  isPrivate: boolean,
  channelType: InboxChannelType,
): Promise<string> {
  const trimmed = (body ?? "").trim();
  if (isPrivate) return trimmed;
  const label = await userLabelInOrg(userId, organizationId);
  if (!label) return trimmed;
  return applyPrefixToBody(formatAgentPrefix(label, channelType), trimmed);
}

export async function prefixOutboundBodyWithBotName(
  organizationId: string,
  botId: string,
  body: string | null | undefined,
  isPrivate: boolean,
  channelType: InboxChannelType,
): Promise<string> {
  const trimmed = (body ?? "").trim();
  if (isPrivate) return trimmed;
  const bot = await prisma.bot.findFirst({
    where: { id: botId, organizationId },
    select: { name: true },
  });
  const label = bot?.name?.trim();
  if (!label) return trimmed;
  return applyPrefixToBody(formatAgentPrefix(label, channelType), trimmed);
}

export async function agentNameOnlyPrefixForced(
  organizationId: string,
  userId: string,
  isPrivate: boolean,
  channelType: InboxChannelType,
): Promise<string | null> {
  if (isPrivate) return null;
  const label = await userLabelInOrg(userId, organizationId);
  if (!label) return null;
  return formatAgentPrefix(label, channelType);
}

export async function botNameOnlyPrefix(
  organizationId: string,
  botId: string,
  isPrivate: boolean,
  channelType: InboxChannelType,
): Promise<string | null> {
  if (isPrivate) return null;
  const bot = await prisma.bot.findFirst({
    where: { id: botId, organizationId },
    select: { name: true },
  });
  const label = bot?.name?.trim();
  if (!label) return null;
  return formatAgentPrefix(label, channelType);
}

/** Prefixo com o nome do atendente — só para envio ao canal externo. */
export async function prefixOutboundBodyForExternalChannel(
  organizationId: string,
  userId: string,
  body: string | null | undefined,
  isPrivate: boolean,
  channelType: InboxChannelType,
): Promise<string> {
  const trimmed = (body ?? "").trim();
  if (isPrivate) return trimmed;

  const prefix = await agentNamePrefixForUser(organizationId, userId, channelType);
  if (!prefix) return trimmed;

  if (trimmed.startsWith(prefix)) return trimmed;
  return trimmed ? `${prefix}\n\n${trimmed}` : prefix;
}

/** Só o cabeçalho do atendente (útil antes de áudio/mídia sem legenda). */
export async function agentNameOnlyPrefixForExternalChannel(
  organizationId: string,
  userId: string,
  isPrivate: boolean,
  channelType: InboxChannelType,
): Promise<string | null> {
  if (isPrivate) return null;
  return agentNamePrefixForUser(organizationId, userId, channelType);
}

/** Telegram usa HTML quando o prefixo contém tags de formatação. */
export function telegramParseModeForAgentPrefix(prefix: string | null | undefined): "HTML" | undefined {
  if (!prefix?.includes("<b>")) return undefined;
  return "HTML";
}
