/**
 * Modelo C6 Opções — formata JSON de audaar_consultar_disponibilidade para o hóspede.
 * Sempre usa tarifa Balcão; exibe diária + total e período consultado; omite nome do plano/tarifa.
 */

const BALCAO_RE = /balc[aã]o/i;

const EMOJI_NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

type RatePlan = {
  channelName?: string;
  ratePlanName?: string;
  averageNightlyPrice?: number;
  totalPrice?: number;
  available?: boolean;
  nightlyPrices?: Array<{ price?: number }>;
};

type Category = {
  categoryName?: string;
  available?: boolean;
  ratePlans?: RatePlan[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function parsePayloadRoot(payload: unknown): Record<string, unknown> | null {
  if (!payload) return null;
  if (typeof payload === "string") {
    try {
      return parsePayloadRoot(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  const root = asRecord(payload);
  if (!root) return null;
  if (typeof root.bodyPreview === "string" && root.bodyPreview.trim().startsWith("{")) {
    try {
      return parsePayloadRoot(JSON.parse(root.bodyPreview));
    } catch {
      /* keep root */
    }
  }
  return asRecord(root.data) ?? root;
}

export function isBalconRatePlan(plan: RatePlan): boolean {
  const channel = (plan.channelName ?? "").trim();
  const name = (plan.ratePlanName ?? "").trim();
  return BALCAO_RE.test(channel) || BALCAO_RE.test(name);
}

/** @deprecated Use isBalconRatePlan */
export function isMotorReservaRatePlan(plan: RatePlan): boolean {
  return isBalconRatePlan(plan);
}

/** Seleciona tarifa Balcão; ignora Motor de reserva, REEMBOLSÁVEL, etc. */
export function selectBalconRatePlan(ratePlans: RatePlan[] | undefined): RatePlan | null {
  if (!ratePlans?.length) return null;
  return ratePlans.find((p) => p.available !== false && isBalconRatePlan(p)) ?? null;
}

/** @deprecated Use selectBalconRatePlan */
export function selectMotorReservaRatePlan(ratePlans: RatePlan[] | undefined): RatePlan | null {
  return selectBalconRatePlan(ratePlans);
}

function formatBrl(value: number): string {
  const n = Math.round(value * 100) / 100;
  const [intPart, decPart = "00"] = n.toFixed(2).split(".");
  const withThousands = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${withThousands},${decPart}`;
}

function formatIsoDateToBr(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = value.trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (br) {
    const dd = br[1]!.padStart(2, "0");
    const mm = br[2]!.padStart(2, "0");
    return `${dd}/${mm}/${br[3]}`;
  }
  return null;
}

/** Período consultado (check-in a check-out) para exibir na cotação. */
export function formatQuoteStayPeriod(data: Record<string, unknown>): string | null {
  const checkin =
    data.checkin ?? data.checkinDate ?? data.checkInDate ?? data.check_in ?? data.arrivalDate;
  const checkout =
    data.checkout ?? data.checkoutDate ?? data.checkOutDate ?? data.check_out ?? data.departureDate;
  const inStr = formatIsoDateToBr(checkin);
  const outStr = formatIsoDateToBr(checkout);
  if (inStr && outStr) return `${inStr} a ${outStr}`;
  if (inStr) return `a partir de ${inStr}`;
  return null;
}

function nightlyPrice(plan: RatePlan): number | null {
  if (typeof plan.averageNightlyPrice === "number" && Number.isFinite(plan.averageNightlyPrice)) {
    return plan.averageNightlyPrice;
  }
  const first = plan.nightlyPrices?.[0]?.price;
  if (typeof first === "number" && Number.isFinite(first)) return first;
  return null;
}

function totalPrice(plan: RatePlan): number | null {
  if (typeof plan.totalPrice === "number" && Number.isFinite(plan.totalPrice)) {
    return plan.totalPrice;
  }
  return nightlyPrice(plan);
}

export function looksLikeAvailabilityQuotePayload(payload: unknown): boolean {
  const data = parsePayloadRoot(payload);
  if (!data) return false;
  return Array.isArray(data.categories);
}

function buildOptionsIntro(data: Record<string, unknown>): string {
  const period = formatQuoteStayPeriod(data);
  if (period) {
    return `Consultei a disponibilidade para o período informado - ${period}. Estas são as opções:`;
  }
  return "Consultei a disponibilidade para o período informado. Estas são as opções:";
}

export function buildModeloC6OptionsReply(payload: unknown): string {
  const data = parsePayloadRoot(payload);
  if (!data) {
    return "Consultei a disponibilidade, mas não recebi opções válidas. Pode informar outras datas?";
  }

  const periodSuffix = formatQuoteStayPeriod(data);
  const periodInBody = periodSuffix ? ` (${periodSuffix})` : "";

  const categories = (data.categories as Category[] | undefined) ?? [];
  const availableCategories = categories.filter((c) => c.available !== false);

  if (availableCategories.length === 0) {
    return (
      `Consultei a disponibilidade para o período informado${periodInBody}, mas não há opções disponíveis no momento. ` +
      "Gostaria de tentar outras datas?"
    );
  }

  const lines: string[] = [];
  let index = 0;
  for (const cat of availableCategories) {
    const plan = selectBalconRatePlan(cat.ratePlans);
    if (!plan) continue;
    const nightly = nightlyPrice(plan);
    const total = totalPrice(plan);
    if (nightly == null && total == null) continue;

    const emoji = EMOJI_NUMBERS[index] ?? `${index + 1}.`;
    const name = (cat.categoryName ?? "Opção").trim();
    const nightlyStr = nightly != null ? `${formatBrl(nightly)} / diária` : null;
    const totalStr = total != null ? `${formatBrl(total)} total` : null;
    const pricePart =
      nightlyStr && totalStr
        ? `${nightlyStr} · ${totalStr}`
        : nightlyStr ?? totalStr ?? "";

    lines.push(`${emoji} ${name} — ${pricePart}`);
    index += 1;
  }

  if (lines.length === 0) {
    return (
      `Consultei a disponibilidade para o período informado${periodInBody}, mas não encontrei tarifas disponíveis ` +
      "no balcão. Gostaria de tentar outras datas ou falar com a equipe?"
    );
  }

  return `${buildOptionsIntro(data)}\n\n${lines.join("\n")}\n\nQual opção você prefere?`;
}

export function replyLooksLikeModeloC6Options(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /consultei a disponibilidade/i.test(t) &&
    /qual opção você prefere/i.test(t) &&
    (/R\$\s*[\d.,]+/i.test(t) || /1️⃣|2️⃣|3️⃣/.test(t))
  );
}

const QUOTE_OPTION_LINE_RE =
  /^(?:\d️⃣|\d+\.|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣|🔟)\s*(.+?)\s*—/;

/** Extrai nomes de categoria do Modelo C6 Opções (última msg do agente). */
export function parseQuoteOptionCategoriesFromOptionsReply(text: string): string[] {
  const categories: string[] = [];
  for (const line of (text ?? "").split(/\n/)) {
    const trimmed = line.trim();
    const m = trimmed.match(QUOTE_OPTION_LINE_RE);
    if (m?.[1]) categories.push(m[1].trim());
  }
  return categories;
}

const ORDINAL_CHOICE_RE: Array<{ re: RegExp; index: number }> = [
  { re: /\b(?:a\s+)?primeir[ao]\b|\bop[cç][aã]o\s*1\b|\bn[úu]mero\s*1\b|^1$/i, index: 0 },
  { re: /\b(?:a\s+)?segund[ao]\b|\bop[cç][aã]o\s*2\b|\bn[úu]mero\s*2\b|^2$/i, index: 1 },
  { re: /\b(?:a\s+)?terceir[ao]\b|\bop[cç][aã]o\s*3\b|\bn[úu]mero\s*3\b|^3$/i, index: 2 },
];

/** Resolve escolha do hóspede (número, ordinal ou nome da categoria). */
export function resolveQuoteOptionChoice(
  userMessage: string,
  categories: string[],
): string | null {
  const msg = (userMessage ?? "").trim();
  if (!msg || categories.length === 0) return null;

  for (const { re, index } of ORDINAL_CHOICE_RE) {
    if (re.test(msg) && categories[index]) return categories[index]!;
  }

  const numMatch = msg.match(/^(?:op[cç][aã]o\s*)?([1-9])\b/i);
  if (numMatch) {
    const idx = Number.parseInt(numMatch[1]!, 10) - 1;
    if (categories[idx]) return categories[idx]!;
  }

  const lower = msg.toLowerCase();
  for (const cat of categories) {
    if (lower.includes(cat.toLowerCase()) || cat.toLowerCase().includes(lower)) {
      return cat;
    }
  }

  if (msg.length <= 80) return msg;
  return null;
}

export function buildModeloC6HandoffReply(chosenOption?: string | null): string {
  const optionPart = chosenOption?.trim()
    ? `Registrei sua preferência: **${chosenOption.trim()}**.\n\n`
    : "";
  return (
    `${optionPart}Perfeito! Vou encaminhar sua preferência para nossa equipe, que dará continuidade na reserva.`
  );
}

export function buildModeloC6DiscountTransferOfferReply(): string {
  return (
    "Entendo sua preocupação com o valor. Não posso conceder descontos por aqui, " +
    "mas posso transferir você para nossa equipe de atendimento para verificar se há " +
    "alguma condição especial disponível.\n\nDeseja que eu faça essa transferência?"
  );
}

export function buildModeloC6DiscountHandoffReply(): string {
  return (
    "Perfeito! Vou transferir você para nossa equipe de atendimento " +
    "para verificar se há algum desconto ou condição especial disponível."
  );
}

export function replyLooksLikeModeloC6Handoff(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /encaminhar sua preferência para nossa equipe|transferir você para nossa equipe de atendimento/i.test(
      t,
    ) &&
    !/\*call_human\*|\*transfer_to_team\*/i.test(t) &&
    !/um momento/i.test(t)
  );
}

export function replyLooksLikeModeloC6DiscountOffer(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /n[aã]o posso conceder descontos/i.test(t) &&
    /transferir.*equipe de atendimento/i.test(t) &&
    /deseja que eu fa[cç]a essa transfer[eê]ncia/i.test(t)
  );
}

/** Hóspede acha caro ou pede desconto (pós-cotação). */
export function messageLooksLikeQuoteDiscountObjection(userMessage?: string | null): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;
  if (/^(sim|ok|okay|certo|confirmo|yes|pode|n[aã]o|nao)$/i.test(msg)) return false;
  return (
    /\b(desconto|mais\s+barat[ao]|abaixar|reduzir\s+o\s+pre[cç]o|negociar|melhor\s+pre[cç]o)\b/i.test(
      msg,
    ) ||
    /\b(muito\s+car[oa]|est[aá]\s+car[oa]|car[oa]\s+demais|pre[cç]o\s+alt[oa]|valor\s+alt[oa])\b/i.test(
      msg,
    )
  );
}
