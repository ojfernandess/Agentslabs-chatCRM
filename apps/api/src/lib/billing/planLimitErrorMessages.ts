export type PlanLimitMessageInput = {
  planName: string | null;
  dimension: string;
  used: number;
  limit: number;
  additional?: number;
};

type ResourceLabel = { singular: string; plural: string };

const LIMIT_KEY_ALIASES: Record<string, string> = {
  users: "users",
  user: "users",
  utilizadores: "users",
  utilizador: "users",
  usuarios: "users",
  usuario: "users",
  seats: "seats",
  seat: "seats",
  lugares: "seats",
  agents: "agents",
  agent: "agents",
  agentes: "agents",
  automations: "automations",
  automation: "automations",
  automacao: "automations",
  automacoes: "automations",
  bots: "automations",
  contacts: "contacts",
  contact: "contacts",
  contatos: "contacts",
  contato: "contacts",
  messages: "messages",
  message: "messages",
  mensagens: "messages",
  mensagem: "messages",
};

function canonicalLimitKey(key: string): string {
  const normalized = key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s-]+/g, "_");
  return LIMIT_KEY_ALIASES[normalized] ?? normalized;
}

const RESOURCE_LABELS_PT: Record<string, ResourceLabel> = {
  agents: { singular: "agente IA", plural: "agentes IA" },
  users: { singular: "usuário", plural: "usuários" },
  seats: { singular: "lugar", plural: "lugares" },
  automations: { singular: "automação/bot", plural: "automações/bots" },
  contacts: { singular: "contacto", plural: "contactos" },
  messages: { singular: "mensagem (mês)", plural: "mensagens (mês)" },
};

const RESOURCE_LABELS_EN: Record<string, ResourceLabel> = {
  agents: { singular: "AI agent", plural: "AI agents" },
  users: { singular: "user", plural: "users" },
  seats: { singular: "seat", plural: "seats" },
  automations: { singular: "automation/bot", plural: "automations/bots" },
  contacts: { singular: "contact", plural: "contacts" },
  messages: { singular: "message (month)", plural: "messages (month)" },
};

function resourceLabel(
  dimension: string,
  count: number,
  locale: "pt" | "en",
): string {
  const canonical = canonicalLimitKey(dimension);
  const labels = locale === "en" ? RESOURCE_LABELS_EN : RESOURCE_LABELS_PT;
  const entry = labels[canonical];
  if (!entry) {
    const fallback = canonical.replace(/_/g, " ");
    return count === 1 ? fallback : `${fallback}s`;
  }
  return count === 1 ? entry.singular : entry.plural;
}

function formatPlanName(planName: string | null, locale: "pt" | "en"): string {
  const trimmed = planName?.trim();
  if (trimmed) return `«${trimmed}»`;
  return locale === "en" ? "your current plan" : "seu plano atual";
}

function formatCount(count: number, locale: "pt" | "en"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "pt-BR").format(count);
}

/** Mensagens cordiais para limite de plano excedido (PT + EN para a UI). */
export function buildPlanLimitExceededMessages(input: PlanLimitMessageInput): {
  message: string;
  messageEn: string;
  resourceLabel: string;
  resourceLabelEn: string;
} {
  const canonical = canonicalLimitKey(input.dimension);
  const planPt = formatPlanName(input.planName, "pt");
  const planEn = formatPlanName(input.planName, "en");
  const limit = input.limit;
  const used = input.used;
  const resourcePt = resourceLabel(canonical, limit, "pt");
  const resourceEn = resourceLabel(canonical, limit, "en");
  const limitPt = formatCount(limit, "pt");
  const limitEn = formatCount(limit, "en");
  const usedPt = formatCount(used, "pt");
  const usedEn = formatCount(used, "en");

  const message =
    `O plano ${planPt} permite no máximo ${limitPt} ${resourcePt}. ` +
    `Atualmente você utiliza ${usedPt} e não é possível adicionar mais. ` +
    `Para ampliar esse limite, faça upgrade do plano em Configurações → Plano e faturação.`;

  const messageEn =
    `Your ${planEn} plan supports up to ${limitEn} ${resourceEn}. ` +
    `You are currently using ${usedEn} and cannot add more. ` +
    `To increase this limit, please upgrade your plan in Settings → Billing.`;

  return { message, messageEn, resourceLabel: resourcePt, resourceLabelEn: resourceEn };
}

export function buildPlanLimitExceededDetails(input: PlanLimitMessageInput): Record<string, unknown> {
  const { message, messageEn, resourceLabel, resourceLabelEn } = buildPlanLimitExceededMessages(input);
  const canonical = canonicalLimitKey(input.dimension);
  return {
    used: input.used,
    limit: input.limit,
    additional: input.additional ?? 1,
    dimension: canonical,
    planName: input.planName,
    resourceLabel,
    resourceLabelEn,
    messageEn,
    upgradeHint: true,
    upgradePath: "/settings/billing",
    userMessage: message,
  };
}
