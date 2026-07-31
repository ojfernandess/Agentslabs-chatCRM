/**
 * Extracção de slots C6 (cotação) a partir de mensagens — alimenta Tool Scheduler.
 */
export type QuoteFlowSlots = Record<string, string | number | boolean>;

const ESTABLISHMENT_ID_BY_NAME: Array<{ pattern: RegExp; id: number; name: string }> = [
  { pattern: /audaar\s*tech/i, id: 49, name: "Audaar Tech Suites" },
  { pattern: /rock\s*cgh|cgh\s*su[ií]tes/i, id: 5, name: "Rock CGH Suítes" },
  { pattern: /vivapp\s*club|club\s*su[ií]tes/i, id: 3, name: "Vivapp Club Suítes" },
  { pattern: /blue\s*ocean|rock\s*blue/i, id: 33, name: "Rock Blue Ocean Suites" },
  { pattern: /anchieta\s*riviera|residencial\s*anchieta/i, id: 40, name: "Residencial Anchieta Riviera" },
  { pattern: /\bvgc\b|apartamento\s*vgc/i, id: 32, name: "Apartamento VGC" },
  { pattern: /brooklin|brookin/i, id: 51, name: "Hotel Brooklin" },
];

function normalizeDateToIso(raw: string): string | null {
  const t = raw.trim();
  const br = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (br) {
    const dd = br[1]!.padStart(2, "0");
    const mm = br[2]!.padStart(2, "0");
    return `${br[3]}-${mm}-${dd}`;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;
  return null;
}

function resolveEstablishmentFromText(text: string): { establishmentName?: string; establishmentId?: number } {
  const propLine =
    text.match(/🏢\s*Propriedade(?:\/unidade)?\s*:?\s*(.+)/i)?.[1]?.trim() ??
    text.match(/propriedade(?:\/unidade)?\s*(?:desejada)?\s*:?\s*(.+)/i)?.[1]?.trim();
  const candidates = [propLine, text].filter(Boolean) as string[];
  for (const candidate of candidates) {
    for (const row of ESTABLISHMENT_ID_BY_NAME) {
      if (row.pattern.test(candidate)) {
        return { establishmentName: row.name, establishmentId: row.id };
      }
    }
  }
  const quoteFor = text.match(/\bcota[cç][aã]o\s+(?:para|em)\s+(.+)/i)?.[1]?.trim();
  if (quoteFor) {
    for (const row of ESTABLISHMENT_ID_BY_NAME) {
      if (row.pattern.test(quoteFor)) {
        return { establishmentName: row.name, establishmentId: row.id };
      }
    }
  }
  return {};
}

/** Extrai slots de cotação (C6) de texto livre ou Modelo C6 Confirm. */
export function extractQuoteFlowSlotsFromText(text: string): QuoteFlowSlots {
  const out: QuoteFlowSlots = {};
  if (!text?.trim()) return out;

  const establishment = resolveEstablishmentFromText(text);
  if (establishment.establishmentName) out.establishmentName = establishment.establishmentName;
  if (establishment.establishmentId != null) out.establishmentId = establishment.establishmentId;

  const checkInRaw =
    text.match(/data de chegada(?:\s*\(check-in\))?\s*:?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i)?.[1] ??
    text.match(/📅\s*Data de chegada\s*:?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i)?.[1];
  const checkOutRaw =
    text.match(/data de partida(?:\s*\(checkout\))?\s*:?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i)?.[1] ??
    text.match(/📅\s*Data de partida\s*:?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/i)?.[1];

  const checkInIso = checkInRaw ? normalizeDateToIso(checkInRaw) : null;
  const checkOutIso = checkOutRaw ? normalizeDateToIso(checkOutRaw) : null;
  if (checkInIso) {
    out.checkinDate = checkInIso;
    out.checkInDate = checkInIso;
  }
  if (checkOutIso) {
    out.checkoutDate = checkOutIso;
    out.checkOutDate = checkOutIso;
  }

  const guestsFromEmoji = text.match(/👤\s*Quantidade de pessoas\s*:?\s*(\d+)/i)?.[1];
  const guestsFromLine = text.match(/(\d+)\s*pessoas?\b/i)?.[1];
  const guests = guestsFromEmoji ?? guestsFromLine;
  if (guests) {
    const n = Number.parseInt(guests, 10);
    if (Number.isFinite(n) && n > 0) {
      out.guestsQuantity = n;
      out.guests = n;
    }
  }

  return out;
}

export function mergeQuoteFlowSlotsFromConversation(opts: {
  flowSlots: QuoteFlowSlots;
  userMessage: string;
  lastAssistantMessage?: string | null;
  historyUserMessages?: string[];
}): QuoteFlowSlots {
  const merged: QuoteFlowSlots = { ...opts.flowSlots };
  const texts = [
    opts.userMessage,
    opts.lastAssistantMessage ?? "",
    ...(opts.historyUserMessages ?? []),
  ];
  for (const text of texts) {
    const extracted = extractQuoteFlowSlotsFromText(text);
    for (const [k, v] of Object.entries(extracted)) {
      if (v !== undefined && v !== null && String(v).trim() !== "") merged[k] = v;
    }
  }
  return merged;
}
