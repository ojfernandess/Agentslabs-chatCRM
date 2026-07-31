/**
 * Modelo C6 Opções — formata JSON de audaar_consultar_disponibilidade para o hóspede.
 * Sempre usa tarifa Balcão; exibe diária + total e período consultado; omite nome do plano/tarifa.
 */

const BALCAO_RE = /balc[aã]o/i;
/** channelId do plano Balcão na API Audaar (fallback quando o nome vem vazio). */
const BALCAO_CHANNEL_IDS = new Set([138, 145]);
/** A partir deste número de hóspedes, exibir combinações de quartos (capacity). */
const MULTI_GUEST_COMBO_THRESHOLD = 5;
const MAX_COMBO_OPTIONS = 8;

/** Hotel Brooklin — establishmentId 51; omitir categorias de garagem/vaga na cotação. */
export const BROOKLIN_ESTABLISHMENT_ID = 51;

const GARAGE_CATEGORY_RE = /\b(garagem|vaga|estacionamento|parking)\b/i;

const EMOJI_NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

type RatePlan = {
  channelId?: number;
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
  capacity?: number;
  minAvailableUnits?: number;
  unitsNeeded?: number;
  ratePlans?: RatePlan[];
};

type BookableRoomType = {
  categoryName: string;
  capacity: number;
  unitPrice: number;
  maxUnits: number;
};

type ComboItem = {
  categoryName: string;
  units: number;
  capacity: number;
  unitPrice: number;
};

export type RoomCombination = {
  items: ComboItem[];
  totalCapacity: number;
  totalPrice: number;
  label: string;
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
  if (plan.available === false) return false;
  if (typeof plan.channelId === "number" && BALCAO_CHANNEL_IDS.has(plan.channelId)) return true;
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

export function isGarageCategoryName(categoryName: string): boolean {
  return GARAGE_CATEGORY_RE.test((categoryName ?? "").trim());
}

function isBrooklinQuote(data: Record<string, unknown>): boolean {
  const id = data.establishmentId ?? data.establishment_id;
  if (typeof id === "number" && id === BROOKLIN_ESTABLISHMENT_ID) return true;
  const name = String(data.establishmentName ?? data.establishment ?? "").toLowerCase();
  return /\bbrooklin\b|\bbrookin\b/.test(name);
}

function shouldIncludeQuoteCategory(data: Record<string, unknown>, cat: Category): boolean {
  if (cat.available === false) return false;
  if (isBrooklinQuote(data) && isGarageCategoryName((cat.categoryName ?? "").trim())) {
    return false;
  }
  return true;
}

function readGuestCount(data: Record<string, unknown>): number {
  const raw = data.guests ?? data.guestsQuantity;
  const guests =
    typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(guests) && guests > 0 ? guests : 0;
}

function extractBookableRoomTypes(
  data: Record<string, unknown>,
  categories: Category[],
): BookableRoomType[] {
  const rooms: BookableRoomType[] = [];
  for (const cat of categories) {
    if (!shouldIncludeQuoteCategory(data, cat)) continue;
    const capacityRaw = cat.capacity;
    const capacity =
      typeof capacityRaw === "number" && capacityRaw > 0 ? capacityRaw : 1;
    const plan = selectBalconRatePlan(cat.ratePlans);
    if (!plan) continue;
    const unitPrice = totalPrice(plan);
    if (unitPrice == null) continue;
    const minAvail =
      typeof cat.minAvailableUnits === "number" && cat.minAvailableUnits > 0
        ? cat.minAvailableUnits
        : 1;
    rooms.push({
      categoryName: (cat.categoryName ?? "Opção").trim(),
      capacity,
      unitPrice,
      maxUnits: minAvail,
    });
  }
  return rooms.sort((a, b) => b.capacity - a.capacity || a.unitPrice - b.unitPrice);
}

function formatComboUnitLabel(categoryName: string, units: number): string {
  return units === 1 ? `1 ${categoryName}` : `${units} ${categoryName}`;
}

function formatCombinationLabel(items: ComboItem[]): string {
  return items.map((i) => formatComboUnitLabel(i.categoryName, i.units)).join(" + ");
}

function combinationKey(items: ComboItem[]): string {
  return items
    .map((i) => `${i.categoryName}\0${i.units}`)
    .sort()
    .join("|");
}

/** Combinações de quartos cuja capacidade total cobre `guests`. */
export function findRoomCombinations(
  rooms: BookableRoomType[],
  guests: number,
): RoomCombination[] {
  if (guests < MULTI_GUEST_COMBO_THRESHOLD || rooms.length === 0) return [];

  const results: RoomCombination[] = [];
  const seen = new Set<string>();

  function dfs(
    roomIdx: number,
    items: ComboItem[],
    totalCapacity: number,
    totalPrice: number,
  ): void {
    if (totalCapacity >= guests) {
      const key = combinationKey(items);
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          items: [...items],
          totalCapacity,
          totalPrice,
          label: formatCombinationLabel(items),
        });
      }
      return;
    }
    if (roomIdx >= rooms.length) return;

    const room = rooms[roomIdx]!;
    const maxByCapacity = Math.max(1, Math.ceil(guests / room.capacity) + 1);
    const maxUnits = Math.min(room.maxUnits, maxByCapacity);

    dfs(roomIdx + 1, items, totalCapacity, totalPrice);

    for (let units = 1; units <= maxUnits; units += 1) {
      dfs(
        roomIdx + 1,
        [
          ...items,
          {
            categoryName: room.categoryName,
            units,
            capacity: room.capacity,
            unitPrice: room.unitPrice,
          },
        ],
        totalCapacity + units * room.capacity,
        totalPrice + units * room.unitPrice,
      );
    }
  }

  dfs(0, [], 0, 0);

  results.sort((a, b) => {
    const aExact = a.totalCapacity === guests ? 0 : 1;
    const bExact = b.totalCapacity === guests ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.totalCapacity !== b.totalCapacity) return a.totalCapacity - b.totalCapacity;
    if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
    const aRooms = a.items.reduce((s, i) => s + i.units, 0);
    const bRooms = b.items.reduce((s, i) => s + i.units, 0);
    return aRooms - bRooms;
  });

  return results.slice(0, MAX_COMBO_OPTIONS);
}

function buildMultiGuestComboOptionsReply(
  data: Record<string, unknown>,
  guests: number,
): string | null {
  const categories = (data.categories as Category[] | undefined) ?? [];
  const rooms = extractBookableRoomTypes(data, categories);
  const combos = findRoomCombinations(rooms, guests);
  if (combos.length === 0) return null;

  const periodSuffix = formatQuoteStayPeriod(data);
  const periodInBody = periodSuffix ? ` (${periodSuffix})` : "";
  const lines: string[] = [];

  combos.forEach((combo, index) => {
    const emoji = EMOJI_NUMBERS[index] ?? `${index + 1}.`;
    lines.push(`${emoji} ${combo.label} — ${formatBrl(combo.totalPrice)} total`);
  });

  return (
    `Para ${guests} hóspedes, consultei a disponibilidade${periodInBody}. ` +
    `Estas são as combinações de quartos:\n\n${lines.join("\n")}\n\nQual opção você prefere?`
  );
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

  const guests = readGuestCount(data);
  if (guests >= MULTI_GUEST_COMBO_THRESHOLD) {
    const comboReply = buildMultiGuestComboOptionsReply(data, guests);
    if (comboReply) return comboReply;
  }

  const periodSuffix = formatQuoteStayPeriod(data);
  const periodInBody = periodSuffix ? ` (${periodSuffix})` : "";

  const categories = (data.categories as Category[] | undefined) ?? [];
  const availableCategories = categories.filter((c) => shouldIncludeQuoteCategory(data, c));

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

/** Reexibe Modelo C6 Opções após dúvida de categoria (C6d) — retorno à cotação. */
export function buildQuoteOptionsReturnPrompt(opts: {
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean>;
  lastOptionsPayload?: unknown;
}): string | null {
  const fromReply = (opts.lastAssistantMessage ?? "").trim();
  if (replyLooksLikeModeloC6Options(fromReply)) {
    return fromReply;
  }
  if (opts.lastOptionsPayload && looksLikeAvailabilityQuotePayload(opts.lastOptionsPayload)) {
    return buildModeloC6OptionsReply(opts.lastOptionsPayload);
  }
  const catalog = readQuoteCatalogFromFlowSlots(opts.flowSlots);
  if (!catalog?.options.length) return null;
  const pseudoPayload = {
    data: {
      establishmentName: catalog.establishmentName,
      checkin: catalog.checkin,
      checkout: catalog.checkout,
      guests: catalog.guests,
      categories: catalog.options.map((o) => ({
        categoryName: o.categoryName,
        available: true,
        ratePlans: [
          {
            channelName: "Balcão",
            totalPrice: o.totalPrice ?? undefined,
            averageNightlyPrice: o.nightlyPrice ?? undefined,
            available: true,
          },
        ],
      })),
    },
  };
  return buildModeloC6OptionsReply(pseudoPayload);
}

export function replyLooksLikeModeloC6Options(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    (/consultei a disponibilidade/i.test(t) ||
      /combinações de quartos/i.test(t) ||
      /para \d+ hóspedes/i.test(t)) &&
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
    const catLower = cat.toLowerCase();
    if (lower === catLower || lower.includes(catLower) || catLower.includes(lower)) {
      return cat;
    }
  }

  if (msg.length <= 80) return msg;
  return null;
}

export type QuoteOptionCatalogEntry = {
  categoryName: string;
  nightlyPrice: number | null;
  totalPrice: number | null;
};

export type QuoteOptionCatalog = {
  establishmentName?: string;
  checkin?: string;
  checkout?: string;
  guests?: number;
  options: QuoteOptionCatalogEntry[];
};

export const QUOTE_OPTIONS_CATALOG_SLOT = "__quoteOptionsCatalog";

/** Catálogo Balcão por categoria — usado no handoff e persistido em flowSlots. */
export function buildQuoteOptionsCatalogFromPayload(payload: unknown): QuoteOptionCatalog | null {
  const data = parsePayloadRoot(payload);
  if (!data) return null;
  const guests = readGuestCount(data);
  const categories = (data.categories as Category[] | undefined) ?? [];

  if (guests >= MULTI_GUEST_COMBO_THRESHOLD) {
    const rooms = extractBookableRoomTypes(data, categories);
    const combos = findRoomCombinations(rooms, guests);
    if (combos.length > 0) {
      return {
        establishmentName:
          typeof data.establishmentName === "string" ? data.establishmentName : undefined,
        checkin:
          formatIsoDateToBr(data.checkin ?? data.checkinDate ?? data.checkInDate) ?? undefined,
        checkout:
          formatIsoDateToBr(data.checkout ?? data.checkoutDate ?? data.checkOutDate) ?? undefined,
        guests,
        options: combos.map((c) => ({
          categoryName: c.label,
          nightlyPrice: null,
          totalPrice: c.totalPrice,
        })),
      };
    }
  }

  const options: QuoteOptionCatalogEntry[] = [];
  for (const cat of categories) {
    if (!shouldIncludeQuoteCategory(data, cat)) continue;
    const plan = selectBalconRatePlan(cat.ratePlans);
    if (!plan) continue;
    options.push({
      categoryName: (cat.categoryName ?? "Opção").trim(),
      nightlyPrice: nightlyPrice(plan),
      totalPrice: totalPrice(plan),
    });
  }
  if (options.length === 0) return null;
  return {
    establishmentName:
      typeof data.establishmentName === "string" ? data.establishmentName : undefined,
    checkin: formatIsoDateToBr(data.checkin ?? data.checkinDate ?? data.checkInDate) ?? undefined,
    checkout:
      formatIsoDateToBr(data.checkout ?? data.checkoutDate ?? data.checkOutDate) ?? undefined,
    guests: guests > 0 ? guests : undefined,
    options,
  };
}

export type QuoteHandoffContext = {
  chosenCategory: string;
  establishmentName?: string;
  checkinDate?: string;
  checkoutDate?: string;
  guests?: number;
  totalPrice?: number | null;
  nightlyPrice?: number | null;
};

function readQuoteCatalogFromFlowSlots(
  flowSlots?: Record<string, string | number | boolean>,
): QuoteOptionCatalog | null {
  if (!flowSlots) return null;
  const raw = flowSlots[QUOTE_OPTIONS_CATALOG_SLOT];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as QuoteOptionCatalog;
  } catch {
    return null;
  }
}

const QUOTE_OPTION_PRICE_LINE_RE =
  /^(?:\d️⃣|\d+\.|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣|🔟)\s*(.+?)\s*—\s*(?:R\$\s*([\d.,]+)\s*\/\s*di[aá]ria\s*·\s*)?R\$\s*([\d.,]+)\s*total/i;

function parseBrlNumber(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Fallback: extrai preços Balcão da msg renderizada (Modelo C6 Opções). */
export function parseQuoteOptionsFromOptionsReply(text: string): QuoteOptionCatalogEntry[] {
  const options: QuoteOptionCatalogEntry[] = [];
  for (const line of (text ?? "").split(/\n/)) {
    const m = line.trim().match(QUOTE_OPTION_PRICE_LINE_RE);
    if (!m?.[1]) continue;
    options.push({
      categoryName: m[1].trim(),
      nightlyPrice: m[2] ? parseBrlNumber(m[2]) : null,
      totalPrice: parseBrlNumber(m[3] ?? ""),
    });
  }
  return options;
}

export function resolveQuoteHandoffContext(opts: {
  userMessage: string;
  lastAssistantMessage?: string;
  lastOptionsPayload?: unknown;
  flowSlots?: Record<string, string | number | boolean>;
}): QuoteHandoffContext | null {
  const catalog =
    buildQuoteOptionsCatalogFromPayload(opts.lastOptionsPayload) ??
    readQuoteCatalogFromFlowSlots(opts.flowSlots);
  const parsedFromReply = opts.lastAssistantMessage
    ? parseQuoteOptionsFromOptionsReply(opts.lastAssistantMessage)
    : [];
  const categoryNames =
    catalog?.options.map((o) => o.categoryName) ??
    parsedFromReply.map((o) => o.categoryName) ??
    parseQuoteOptionCategoriesFromOptionsReply(opts.lastAssistantMessage ?? "");

  const chosen = resolveQuoteOptionChoice(opts.userMessage, categoryNames);
  if (!chosen) return null;

  const chosenNorm = chosen.trim().toLowerCase();
  const catalogEntry =
    catalog?.options.find((o) => o.categoryName.toLowerCase() === chosenNorm) ??
    catalog?.options.find(
      (o) =>
        chosenNorm.includes(o.categoryName.toLowerCase()) ||
        o.categoryName.toLowerCase().includes(chosenNorm),
    ) ??
    parsedFromReply.find((o) => o.categoryName.toLowerCase() === chosenNorm) ??
    parsedFromReply.find(
      (o) =>
        chosenNorm.includes(o.categoryName.toLowerCase()) ||
        o.categoryName.toLowerCase().includes(chosenNorm),
    );

  const slots = opts.flowSlots ?? {};
  const establishmentName =
    (typeof slots.establishmentName === "string" && slots.establishmentName.trim()) ||
    catalog?.establishmentName ||
    undefined;
  const checkinDate =
    formatIsoDateToBr(slots.checkinDate ?? slots.checkInDate ?? slots.checkin) ??
    catalog?.checkin;
  const checkoutDate =
    formatIsoDateToBr(slots.checkoutDate ?? slots.checkOutDate ?? slots.checkout) ??
    catalog?.checkout;
  const guestsRaw = slots.guestsQuantity ?? slots.guests ?? catalog?.guests;
  const guests =
    typeof guestsRaw === "number"
      ? guestsRaw
      : Number.parseInt(String(guestsRaw ?? ""), 10);

  return {
    chosenCategory: catalogEntry?.categoryName ?? chosen,
    establishmentName,
    checkinDate: checkinDate ?? undefined,
    checkoutDate: checkoutDate ?? undefined,
    guests: Number.isFinite(guests) && guests > 0 ? guests : undefined,
    nightlyPrice: catalogEntry?.nightlyPrice ?? null,
    totalPrice: catalogEntry?.totalPrice ?? null,
  };
}

export function buildModeloC6HandoffReply(
  ctx: QuoteHandoffContext | string | null | undefined,
): string {
  const resolved: QuoteHandoffContext =
    typeof ctx === "string"
      ? { chosenCategory: ctx.trim(), nightlyPrice: null, totalPrice: null }
      : ctx ?? { chosenCategory: "Opção escolhida", nightlyPrice: null, totalPrice: null };

  const lines = ["Perfeito! Então temos:", ""];
  if (resolved.establishmentName) {
    lines.push(`🏢 Propriedade: ${resolved.establishmentName}`);
  }
  if (resolved.checkinDate) {
    lines.push(`📅 Data de chegada: ${resolved.checkinDate}`);
  }
  if (resolved.checkoutDate) {
    lines.push(`📅 Data de partida: ${resolved.checkoutDate}`);
  }
  lines.push(`🛏️ ${resolved.chosenCategory}`);
  if (resolved.guests != null) {
    lines.push(`👤 Quantidade de pessoas: ${resolved.guests}`);
  }
  if (resolved.totalPrice != null) {
    lines.push(`💰 Valor: ${formatBrl(resolved.totalPrice)} total`);
  } else if (resolved.nightlyPrice != null) {
    lines.push(`💰 Valor: ${formatBrl(resolved.nightlyPrice)} / diária`);
  }
  lines.push(
    "",
    "Vou encaminhar seu atendimento para nossa equipe, que dará continuidade na reserva.",
  );
  return lines.join("\n");
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
    (/perfeito!\s*ent[aã]o temos/i.test(t) ||
      /encaminhar sua preferência para nossa equipe|encaminhar seu atendimento para nossa equipe/i.test(
        t,
      )) &&
    /propriedade:|data de chegada:|quantidade de pessoas:/i.test(t) &&
    !/\*call_human\*|\*transfer_to_team\*/i.test(t) &&
    !/um momento/i.test(t)
  );
}

/** Resposta genérica pós-tool (API interna) — não substitui mensagem de escalonamento. */
export function replyLooksLikeGenericToolDeliveryAck(text?: string | null): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /^segue o resultado da consulta:/i.test(t) ||
    /\bconversa aberta para atendimento humano\b/i.test(t)
  );
}

/** Resposta substantiva de handoff C6/C13 — deve ir ao hóspede em vez da msg genérica de escalonamento. */
export function replyShouldPreemptEscalationTransferMessage(text: string): boolean {
  if (replyLooksLikeGenericToolDeliveryAck(text)) return false;
  if (replyLooksLikeModeloC6Handoff(text)) return true;
  const t = (text ?? "").trim();
  if (!t) return false;
  if (
    /perfeito!/i.test(t) &&
    /transferir.*equipe de atendimento/i.test(t) &&
    /desconto|condi[cç][aã]o especial/i.test(t)
  ) {
    return true;
  }
  return (
    /sinto muito/i.test(t) &&
    /(?:equipe de atendimento|transferir|encaminh)/i.test(t) &&
    t.length >= 60
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
