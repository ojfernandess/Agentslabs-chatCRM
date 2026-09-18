import type { ConversationPriority, ConversationStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

const DEFAULT_MAX_CONVERSATIONS = 8;
const DEFAULT_MAX_MESSAGES = 6;
const DEFAULT_MAX_MESSAGE_CHARS = 350;
const DEFAULT_MAX_CONTEXT_CHARS = 48_000;

export type TeamHubCopilotTeam = {
  id: string;
  name: string;
  isOrgCollaborationSpace: boolean;
  purpose: string;
};

type DealSnippet = {
  name: string;
  amountCents: number;
  status: string;
  currency: string;
};

type ConversationRow = {
  id: string;
  status: ConversationStatus;
  priority: ConversationPriority | null;
  updatedAt: Date;
  closureValue: number | null;
  assignedTo: { name: string } | null;
  inbox: { name: string };
  team: { name: string } | null;
  leadType: { name: string } | null;
  contact: {
    name: string;
    tags: { tag: { name: string } }[];
    pipelineStage: { name: string } | null;
    dealsPrimary: DealSnippet[];
  };
  messages: { direction: string; body: string | null; isPrivate: boolean | null }[];
};

export type TeamHubCopilotLoadedContext = {
  team: TeamHubCopilotTeam;
  totalCount: number;
  sampledCount: number;
  maxConversations: number;
  byStatus: Record<string, number>;
  byInbox: { name: string; count: number }[];
  conversations: ConversationRow[];
};

function readBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export function teamHubCopilotMaxConversations(): number {
  return readBoundedInt(process.env.TEAM_COPILOT_MAX_CONVERSATIONS, DEFAULT_MAX_CONVERSATIONS, 3, 20);
}

export function teamHubCopilotMaxMessages(): number {
  return readBoundedInt(process.env.TEAM_COPILOT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES, 2, 12);
}

export function teamHubCopilotMaxMessageChars(): number {
  return readBoundedInt(process.env.TEAM_COPILOT_MAX_MESSAGE_CHARS, DEFAULT_MAX_MESSAGE_CHARS, 120, 800);
}

export function teamHubCopilotMaxContextChars(): number {
  return readBoundedInt(process.env.TEAM_COPILOT_MAX_CONTEXT_CHARS, DEFAULT_MAX_CONTEXT_CHARS, 12_000, 120_000);
}

function normalizeCopilotText(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function truncateCopilotText(text: string, maxChars: number): string {
  const normalized = normalizeCopilotText(text);
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return "…";
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function buildCopilotTranscript(
  messages: ConversationRow["messages"],
  maxMessages: number,
  maxBodyChars: number,
): string {
  const lines: string[] = [];
  const slice = messages.length > maxMessages ? messages.slice(-maxMessages) : messages;
  for (const message of slice) {
    if (message.isPrivate) continue;
    const body = (message.body ?? "").trim();
    if (!body) continue;
    const label = message.direction === "INBOUND" ? "Cliente" : "Atendente";
    lines.push(`${label}: ${truncateCopilotText(body, maxBodyChars)}`);
  }
  return lines.join("\n");
}

function conversationWhere(
  organizationId: string,
  team: TeamHubCopilotTeam,
): Prisma.ConversationWhereInput {
  const base: Prisma.ConversationWhereInput = {
    organizationId,
    deletedAt: null,
  };
  if (team.isOrgCollaborationSpace) return base;
  return { ...base, teamId: team.id };
}

const conversationSelect = (messageLimit: number) =>
  ({
    id: true,
    status: true,
    priority: true,
    updatedAt: true,
    closureValue: true,
    assignedTo: { select: { name: true } },
    inbox: { select: { name: true } },
    team: { select: { name: true } },
    leadType: { select: { name: true } },
    contact: {
      select: {
        name: true,
        tags: { select: { tag: { select: { name: true } } } },
        pipelineStage: { select: { name: true } },
        dealsPrimary: {
          where: { status: "OPEN" as const },
          select: { name: true, amountCents: true, status: true, currency: true },
          take: 3,
          orderBy: { updatedAt: "desc" as const },
        },
      },
    },
    messages: {
      orderBy: { createdAt: "desc" as const },
      take: messageLimit,
      select: { direction: true, body: true, isPrivate: true },
    },
  }) satisfies Prisma.ConversationSelect;

export async function loadTeamHubCopilotContext(
  organizationId: string,
  team: TeamHubCopilotTeam,
): Promise<TeamHubCopilotLoadedContext> {
  const where = conversationWhere(organizationId, team);
  const maxConversations = teamHubCopilotMaxConversations();
  const maxMessages = teamHubCopilotMaxMessages();

  const [totalCount, statusCounts, inboxGroups, recentConvos] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.conversation.groupBy({
      by: ["inboxId"],
      where,
      _count: { _all: true },
    }),
    prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: maxConversations,
      select: conversationSelect(maxMessages),
    }),
  ]);

  const inboxIds = inboxGroups.map((row) => row.inboxId);
  const inboxes =
    inboxIds.length > 0
      ? await prisma.inbox.findMany({
          where: { id: { in: inboxIds }, organizationId },
          select: { id: true, name: true },
        })
      : [];
  const inboxNameById = new Map(inboxes.map((inbox) => [inbox.id, inbox.name]));

  const byStatus: Record<string, number> = { OPEN: 0, PENDING: 0, RESOLVED: 0 };
  for (const row of statusCounts) {
    byStatus[row.status] = row._count._all;
  }

  const byInbox = inboxGroups
    .map((row) => ({
      name: inboxNameById.get(row.inboxId) ?? "Caixa desconhecida",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    team,
    totalCount,
    sampledCount: recentConvos.length,
    maxConversations,
    byStatus,
    byInbox,
    conversations: recentConvos.map((row) => ({
      ...row,
      messages: [...row.messages].reverse(),
    })),
  };
}

function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

function formatDeals(deals: DealSnippet[]): string {
  if (!deals.length) return "—";
  return deals
    .map((deal) => `${deal.name} (${formatMoney(deal.amountCents, deal.currency)} · ${deal.status})`)
    .join("; ");
}

export function formatTeamHubCopilotSystemPrompt(ctx: TeamHubCopilotLoadedContext): string {
  const scope = ctx.team.isOrgCollaborationSpace
    ? "todas as caixas e conversas da organização (visão consolidada)"
    : `conversas atribuídas à equipe «${ctx.team.name}»`;

  return [
    "Você é copiloto operacional de atendimento em um CRM.",
    `Escopo dos dados: ${scope}.`,
    "Use somente os metadados e trechos de conversa fornecidos; não invente conversas, etiquetas, leads ou valores.",
    "Responda em português do Brasil, de forma concisa e acionável para supervisores e agentes.",
  ].join("\n");
}

export function formatTeamHubCopilotStatsBlock(ctx: TeamHubCopilotLoadedContext): string {
  const statusLine = `OPEN ${ctx.byStatus.OPEN ?? 0} · PENDING ${ctx.byStatus.PENDING ?? 0} · RESOLVED ${ctx.byStatus.RESOLVED ?? 0}`;
  const inboxLine =
    ctx.byInbox.length > 0
      ? ctx.byInbox.map((row) => `${row.name} (${row.count})`).join(", ")
      : "—";
  const sampleNote =
    ctx.totalCount > ctx.sampledCount
      ? `${ctx.sampledCount} conversas mais recentes de ${ctx.totalCount} no escopo`
      : `${ctx.totalCount} conversa(s) no escopo`;

  return [
    "Resumo operacional:",
    `- Total no escopo: ${ctx.totalCount} (${sampleNote})`,
    `- Por status: ${statusLine}`,
    `- Por caixa: ${inboxLine}`,
  ].join("\n");
}

export function formatTeamHubCopilotConversationBlock(row: ConversationRow, index: number): string {
  const tags = row.contact.tags.map((t) => t.tag.name).filter(Boolean);
  const meta = [
    `Contato: ${row.contact.name || "—"}`,
    `Status: ${row.status}`,
    row.priority ? `Prioridade: ${row.priority}` : null,
    `Caixa: ${row.inbox.name}`,
    row.team?.name ? `Equipe: ${row.team.name}` : null,
    row.assignedTo?.name ? `Atendente: ${row.assignedTo.name}` : "Atendente: —",
    row.leadType?.name ? `Tipo de lead: ${row.leadType.name}` : null,
    row.contact.pipelineStage?.name ? `Estágio do funil: ${row.contact.pipelineStage.name}` : null,
    tags.length ? `Etiquetas: ${tags.join(", ")}` : "Etiquetas: —",
    row.closureValue != null ? `Valor de fechamento: ${row.closureValue}` : null,
    `Negócios abertos: ${formatDeals(row.contact.dealsPrimary)}`,
    `Atualizado: ${row.updatedAt.toISOString()}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" | ");

  const transcript = buildCopilotTranscript(
    row.messages,
    teamHubCopilotMaxMessages(),
    teamHubCopilotMaxMessageChars(),
  );
  return [
    `--- Conversa #${index + 1} ---`,
    meta,
    "Histórico recente:",
    transcript.trim() || "(sem mensagens públicas de texto)",
  ].join("\n");
}

export function formatTeamHubCopilotUserContext(ctx: TeamHubCopilotLoadedContext, userPrompt: string): string {
  const stats = formatTeamHubCopilotStatsBlock(ctx);
  const promptBlock = `Pedido do usuário:\n${userPrompt.trim()}`;
  const header = `${stats}\n\nConversas (detalhe):\n`;
  const budget = teamHubCopilotMaxContextChars();
  let remaining = budget - promptBlock.length - header.length - 80;
  if (remaining < 800) remaining = 800;

  const blocks: string[] = [];
  let omitted = 0;

  if (ctx.conversations.length === 0) {
    return [`${header}Nenhuma conversa no escopo atual.`, promptBlock].join("\n\n");
  }

  for (let index = 0; index < ctx.conversations.length; index++) {
    const block = formatTeamHubCopilotConversationBlock(ctx.conversations[index]!, index);
    if (block.length > remaining) {
      if (blocks.length === 0 && remaining > 200) {
        blocks.push(`${block.slice(0, remaining - 20)}…`);
        omitted = ctx.conversations.length - 1;
      } else {
        omitted = ctx.conversations.length - index;
      }
      break;
    }
    blocks.push(block);
    remaining -= block.length + 2;
  }

  let detail = blocks.join("\n\n");
  if (omitted > 0) {
    detail += `\n\n… ${omitted} conversa(s) omitida(s) para respeitar o limite de contexto do modelo.`;
  }

  let body = `${header}${detail}`;
  if (body.length + promptBlock.length + 2 > budget) {
    const allowedBody = Math.max(400, budget - promptBlock.length - 80);
    body = `${body.slice(0, allowedBody)}…\n\n… contexto truncado para respeitar o limite do modelo.`;
  }

  return [body, promptBlock].join("\n\n");
}
