import type { ConversationPriority, ConversationStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { buildPublicConversationTranscript } from "./agentAssistLlm.js";

const DEFAULT_MAX_CONVERSATIONS = 15;
const DEFAULT_MAX_MESSAGES = 12;

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
  return readBoundedInt(process.env.TEAM_COPILOT_MAX_CONVERSATIONS, DEFAULT_MAX_CONVERSATIONS, 3, 40);
}

export function teamHubCopilotMaxMessages(): number {
  return readBoundedInt(process.env.TEAM_COPILOT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES, 4, 30);
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

  const transcript = buildPublicConversationTranscript(row.messages, teamHubCopilotMaxMessages());
  return [
    `--- Conversa #${index + 1} ---`,
    meta,
    "Histórico recente:",
    transcript.trim() || "(sem mensagens públicas de texto)",
  ].join("\n");
}

export function formatTeamHubCopilotUserContext(ctx: TeamHubCopilotLoadedContext, userPrompt: string): string {
  const stats = formatTeamHubCopilotStatsBlock(ctx);
  const blocks =
    ctx.conversations.length > 0
      ? ctx.conversations.map((row, index) => formatTeamHubCopilotConversationBlock(row, index)).join("\n\n")
      : "Nenhuma conversa no escopo atual.";

  return [`${stats}\n\nConversas (detalhe):\n${blocks}`, `Pedido do usuário:\n${userPrompt.trim()}`].join(
    "\n\n",
  );
}
