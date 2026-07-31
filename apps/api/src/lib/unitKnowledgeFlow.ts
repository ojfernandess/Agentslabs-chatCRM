/**
 * Fluxos C17 (check-out), C18 (comodidade), C19 (recibo/NF) e localizador isolado.
 */

import {
  extractReservationReferenceFromMessage,
} from "./knowledgeQueryEnrichment.js";

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

/** Agente pediu unidade/estabelecimento no fluxo C17/C18/C19 (menu 1–7 ou pergunta explícita). */
export function assistantRequestedEstablishmentForUnitKb(
  lastAssistantMessage?: string | null,
): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;

  const showsEstablishmentMenu =
    (/1️⃣/.test(t) && /7️⃣/.test(t)) ||
    (/\bAudaar Tech Suites\b/i.test(t) && /\bHotel Brooklin\b/i.test(t));

  const asksForUnit =
    /\bqual\s+(?:delas|unidade|estabelecimento|hotel)\b/i.test(t) ||
    /\bem\s+qual\s+(?:unidade|estabelecimento|hotel)\b/i.test(t) ||
    /\bnome\s+(?:do\s+)?(?:estabelecimento|hotel)\b/i.test(t) ||
    /\bpreciso\s+saber\s+(?:em\s+)?qual\s+unidade\b/i.test(t) ||
    /\binforme\s+(?:o\s+)?(?:nome\s+(?:do\s+)?)?(?:estabelecimento|hotel)\b/i.test(t);

  if (!showsEstablishmentMenu && !asksForUnit) return false;

  return (
    showsEstablishmentMenu ||
    /\b(?:nota\s+fiscal|\bnf\b|recibo|comprovante|fatura)\b/i.test(t) ||
    /\bcheck[\s-]?out\b/i.test(t) ||
    /\b(?:ferro|secador|comodidade)\b/i.test(t)
  );
}

/**
 * Resposta só com unidade (ex.: «Hotel Brooklin» ou «7») após coleta C17/C18/C19
 * → exige buscar_conhecimento neste turno.
 */
export function shouldRequireUnitKnowledgeLookupThisTurn(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): boolean {
  if (!resolveEstablishmentInConversation(opts)) return false;

  const msg = (opts.userMessage ?? "").trim();
  if (
    userMessageLooksLikeCheckoutProcedureQuestion(msg) ||
    userMessageLooksLikeReceiptOrInvoiceRequest(msg) ||
    userMessageLooksLikeAmenityItemQuestion(msg)
  ) {
    return true;
  }

  return assistantRequestedEstablishmentForUnitKb(opts.lastAssistantMessage);
}

/** Mensagem contém só o localizador (ex.: DE4KRMDP). */
export function messageIsStandaloneReservationLocator(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  const loc = extractReservationReferenceFromMessage(t);
  if (!loc) return false;
  const remainder = t.replace(new RegExp(loc, "i"), "").replace(/[\s.,!?;:–—-]+/g, "");
  return remainder.length === 0;
}

/** Agente enviou formulário NF (lista de campos). */
export function assistantSentNfDataForm(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  if (!/\b(?:nota\s+fiscal|\bnf\b|recibo|comprovante|fatura)\b/i.test(t)) return false;
  const fieldHits = [
    /\bnome\s+completo\b/i,
    /\bcpf\s+ou\s+cnpj\b/i,
    /\bcep\b/i,
    /\btelefone\b/i,
    /\bper[ií]odo\b/i,
    /\bvalor\b/i,
    /\bquarto\b/i,
  ].filter((r) => r.test(t)).length;
  return fieldHits >= 3;
}

/** Turno anterior está no fluxo C19 (formulário, espelho ou pedido NF). */
export function assistantIsNfFlowTurn(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    assistantSentNfDataForm(t) ||
    assistantSentNfConfirmationMirror(t) ||
    /\b(?:nota\s+fiscal|\bnf\b|recibo|comprovante|fatura)\b/i.test(t)
  );
}

/** Agente pediu localizador (opcional ou não) no fluxo NF. */
export function assistantRequestedOptionalNfLocator(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t || !/\blocalizador\b/i.test(t)) return false;
  if (!assistantIsNfFlowTurn(t) && !assistantSentNfDataForm(t)) return false;
  return true;
}

/** Hóspede enviou bloco com campos do formulário NF. */
export function userMessageLooksLikeNfFormSubmission(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  if (messageIsStandaloneReservationLocator(t)) return false;
  const fieldHits = [
    /\bnome\s+completo\b/i,
    /\bcpf\s+ou\s+cnpj\b/i,
    /\bcep\b/i,
    /\btelefone\b/i,
    /\bper[ií]odo\b/i,
    /\bvalor\b/i,
    /\be-?mail\b/i,
    /\bquarto\b/i,
    /\bh[oó]spede\b/i,
  ].filter((r) => r.test(t)).length;
  const lines = t.split(/\n/).filter((l) => l.trim()).length;
  return fieldHits >= 2 && (lines >= 2 || t.length >= 60);
}

/** Última msg do agente = espelho de confirmação NF. */
export function assistantSentNfConfirmationMirror(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  if (!/\b(?:confirme|confira|est[aá]\s+correto|espelho|correto\?|dados\s+(?:para|da))\b/i.test(t)) {
    return false;
  }
  return (
    /\b(?:nota\s+fiscal|\bnf\b|recibo)\b/i.test(t) &&
    [/\bnome\s+completo\b/i, /\bcpf\b/i, /\bcep\b/i, /\btelefone\b/i].filter((r) => r.test(t)).length >= 2
  );
}

/** `sim`/`ok` após espelho NF → call_human (C19 passo 4). */
export function shouldRequireCallHumanAfterNfConfirmation(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
}): boolean {
  const msg = (opts.userMessage ?? "").trim();
  if (!/^(sim|ok|okay|certo|confirmo|confirma|yes|yep|pode|est[aá]\s+correto|correto|isso|tudo\s+certo)$/i.test(msg)) {
    return false;
  }
  return assistantSentNfConfirmationMirror(opts.lastAssistantMessage);
}

/** Agente pediu localizador (NF, senha, etc.). */
export function assistantMentionedReservationLocator(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t || !/\blocalizador\b/i.test(t)) return false;
  if (assistantRequestedOptionalNfLocator(t)) return true;
  if (/\b(nota\s+fiscal|\bnf\b|recibo|comprovante|fatura)\b/i.test(t)) return true;
  if (/\b(per[ií]odo|valor|quarto|h[oó]spede|unidade)\b/i.test(t)) return true;
  if (/\b(senha|acesso|c[oó]digo)\b/i.test(t)) return true;
  if (/\b(?:me\s+)?(?:informe|envie|mande|passe)\b/i.test(t)) return true;
  if (/localizador\s+(?:da\s+)?reserva/i.test(t)) return true;
  return false;
}

/** Localizador isolado após pedido do agente → consultar_reserva (+ main_guest se NF). */
export function shouldRequireReservationLookupThisTurn(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
}): boolean {
  return (
    messageIsStandaloneReservationLocator(opts.userMessage) &&
    assistantMentionedReservationLocator(opts.lastAssistantMessage)
  );
}

/** @deprecated Use assistantMentionedReservationLocator */
export const assistantRequestedReservationLocator = assistantMentionedReservationLocator;

/** NF + localizador → consultar_reserva e consultar_main_guest. */
export function shouldRequireNfGuestLookupWithReservation(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
}): boolean {
  if (!shouldRequireReservationLookupThisTurn(opts)) return false;
  return assistantIsNfFlowTurn(opts.lastAssistantMessage);
}
