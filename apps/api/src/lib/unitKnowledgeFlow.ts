/**
 * Fluxos C17 (check-out), C18 (comodidade) e C19 (recibo/NF) — coleta de unidade + KB.
 */

export const ESTABLISHMENT_MENU: ReadonlyArray<{ digit: string; name: string }> = [
  { digit: "1", name: "Audaar Tech Suites" },
  { digit: "2", name: "Rock CGH Suítes" },
  { digit: "3", name: "Vivapp Club Suítes" },
  { digit: "4", name: "Rock Blue Ocean Suites" },
  { digit: "5", name: "Residencial Anchieta Riviera" },
  { digit: "6", name: "Apartamento VGC" },
  { digit: "7", name: "Hotel Brooklin" },
];

const ESTABLISHMENT_ALIASES: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /\bbrooklin\b/i, name: "Hotel Brooklin" },
  { pattern: /\bclub\s*su[ií]tes|vivapp\s*club\b/i, name: "Vivapp Club Suítes" },
  { pattern: /\briviera|anchieta\b/i, name: "Residencial Anchieta Riviera" },
  { pattern: /\baudaar\s*tech\b/i, name: "Audaar Tech Suites" },
  { pattern: /\brock\s*cgh\b/i, name: "Rock CGH Suítes" },
  { pattern: /\bblue\s*ocean|rock\s*blue\b/i, name: "Rock Blue Ocean Suites" },
  { pattern: /\bapartamento\s*vgc|\bvgc\b/i, name: "Apartamento VGC" },
];

/** Pergunta sobre procedimento de check-out (≠ check-in, ≠ data de partida na cotação). */
export function userMessageLooksLikeCheckoutProcedureQuestion(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  if (/data de (?:chegada|partida)\s*\(check/i.test(t)) return false;
  if (/\b(cota[cç][aã]o|disponibilidade|pre[cç]o|di[aá]ria|reservar)\b/i.test(t)) return false;
  if (/\bcheck[\s-]?in\b/i.test(t) && !/\bcheck[\s-]?out\b/i.test(t)) return false;

  return (
    /\bcheck[\s-]?out\b/i.test(t) ||
    /\b(?:realizar|fazer)\s+(?:o\s+)?check[\s-]?out\b/i.test(t) ||
    /\bcomo\s+(?:funciona|fa[cç]o|é)\s+(?:o\s+)?check[\s-]?out\b/i.test(t) ||
    /\bprocedimento\s+(?:de\s+)?(?:sa[ií]da|check[\s-]?out)\b/i.test(t) ||
    /\bhora\s+(?:de\s+)?(?:sa[ií]da|check[\s-]?out)\b/i.test(t) ||
    /\bcomo\s+(?:funciona|fa[cç]o)\s+(?:a\s+)?sa[ií]da\b/i.test(t) ||
    /\bcomo\s+sair\s+do\s+(?:hotel|quarto|apartamento)\b/i.test(t)
  );
}

/** Pedido de recibo ou nota fiscal. */
export function userMessageLooksLikeReceiptOrInvoiceRequest(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  return (
    /\b(?:nota\s+fiscal|\bnf\b|recibo|comprovante|fatura)\b/i.test(t) ||
    /\b(?:emitir|solicitar|pedir|quero)\s+(?:a\s+)?(?:nota|recibo)\b/i.test(t)
  );
}

/** Pergunta sobre item/comodidade específica (ferro, secador, etc.). */
export function userMessageLooksLikeAmenityItemQuestion(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  if (userMessageLooksLikeCheckoutProcedureQuestion(t)) return false;
  if (userMessageLooksLikeReceiptOrInvoiceRequest(t)) return false;
  return (
    /\b(?:tem|possui|h[aá]|disponibiliza|fornece)\s+(?:um\s+)?(?:ferro|secador|cafeteira|micro[\s-]?ondas|frigobar|toalha|len[cç][oó]l)\b/i.test(
      t,
    ) ||
    /\bferro\s+de\s+passar\b/i.test(t) ||
    /\b(?:item|comodidade|equipamento)\b/i.test(t)
  );
}

export function resolveEstablishmentInConversation(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): string | null {
  const parts = [
    opts.userMessage ?? "",
    opts.lastAssistantMessage ?? "",
    String(opts.flowSlots?.establishmentName ?? ""),
    String(opts.flowSlots?.establishment ?? ""),
    String(opts.flowSlots?.propertyName ?? ""),
  ];
  const combined = parts.join("\n");

  const menuDigit = (opts.userMessage ?? "").trim().match(/^([1-7])$/);
  if (menuDigit) {
    const hit = ESTABLISHMENT_MENU.find((e) => e.digit === menuDigit[1]);
    if (hit) return hit.name;
  }

  for (const { pattern, name } of ESTABLISHMENT_ALIASES) {
    if (pattern.test(combined)) return name;
  }

  for (const { name } of ESTABLISHMENT_MENU) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(escaped, "i").test(combined)) return name;
  }

  return null;
}

export function unitKbTurnNeedsEstablishmentCollection(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): boolean {
  const msg = (opts.userMessage ?? "").trim();
  if (!msg) return false;
  const needsUnit =
    userMessageLooksLikeCheckoutProcedureQuestion(msg) ||
    userMessageLooksLikeReceiptOrInvoiceRequest(msg) ||
    userMessageLooksLikeAmenityItemQuestion(msg);
  if (!needsUnit) return false;
  return !resolveEstablishmentInConversation(opts);
}
