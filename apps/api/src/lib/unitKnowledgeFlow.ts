/**
 * Fluxos C17 (check-out), C18 (comodidade), C19 (recibo/NF) e localizador isolado.
 */

import {
  extractReservationReferenceFromMessage,
} from "./knowledgeQueryEnrichment.js";
import { messageLooksLikeHumanHandoffRequest } from "./agent-engine/escalation/escalationTurnDetection.js";

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
  { pattern: /\budaar\s*tech\b/i, name: "Audaar Tech Suites" },
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

  // Bloco de formulário recibo/NF (datas de estadia) — não é pergunta de procedimento C17.
  if (
    (/🏨/.test(t) || /\bnome da hospedagem\b/i.test(t)) &&
    /\b(?:check[\s-]?in|checkout|quarto|localizador)\b/i.test(t)
  ) {
    return false;
  }

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

function resolveEstablishmentFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;

  const menuDigit = t.match(/^([1-7])$/);
  if (menuDigit) {
    const hit = ESTABLISHMENT_MENU.find((e) => e.digit === menuDigit[1]);
    if (hit) return hit.name;
  }

  for (const { pattern, name } of ESTABLISHMENT_ALIASES) {
    if (pattern.test(t)) return name;
  }

  for (const { name } of ESTABLISHMENT_MENU) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(escaped, "i").test(t)) return name;
  }

  return null;
}

export function resolveEstablishmentInConversation(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): string | null {
  const userMsg = (opts.userMessage ?? "").trim();
  if (userMsg) {
    const fromUser = resolveEstablishmentFromText(userMsg);
    if (fromUser) return fromUser;
  }

  for (const slot of [
    opts.flowSlots?.establishmentName,
    opts.flowSlots?.establishment,
    opts.flowSlots?.propertyName,
  ]) {
    const fromSlot = resolveEstablishmentFromText(String(slot ?? ""));
    if (fromSlot) return fromSlot;
  }

  // Só usa a última msg do agente quando o hóspede não enviou texto neste turno
  // (evita falso positivo ao listar o menu 1–7 no fluxo C17/C18/C19).
  if (!userMsg && opts.lastAssistantMessage) {
    return resolveEstablishmentFromText(opts.lastAssistantMessage);
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
  if (userMessageLooksLikeReceiptFormSubmission(msg)) return false;
  if (assistantSentReceiptDataForm(opts.lastAssistantMessage) && msg) return false;

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

/** @deprecated Fluxo C19 não usa mais localizador opcional. */
export function assistantRequestedOptionalNfLocator(_lastAssistantMessage?: string | null): boolean {
  return false;
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

/** Agente enviou formulário de recibo PF/PJ (Passo 2b). */
export function assistantSentReceiptDataForm(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t || !/\brecibo\b/i.test(t)) return false;
  if (/\bnome completo\b/i.test(t) && /\bcpf\s+ou\s+cnpj\b/i.test(t)) return false;
  const receiptFieldHits = [
    /🏨|\bnome da hospedagem\b/i,
    /\blocalizador\b/i,
    /🛏️|\bquarto\b/i,
    /⏰|\bcheck[\s-]?in\b/i,
    /\bcheckout\b/i,
    /\braz[aã]o social\b/i,
    /\bcnpj\b/i,
  ].filter((r) => r.test(t)).length;
  return receiptFieldHits >= 3;
}

/** Hóspede enviou bloco do formulário de recibo (PF ou PJ). */
export function userMessageLooksLikeReceiptFormSubmission(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  if (messageIsStandaloneReservationLocator(t)) return false;
  const fieldHits = [
    /🏨|\bnome da hospedagem\b/i,
    /\blocalizador\b/i,
    /🛏️|\bquarto\b/i,
    /⏰|\bcheck[\s-]?in\b/i,
    /\bcheckout\b/i,
    /\braz[aã]o social\b/i,
    /\bcnpj\b/i,
  ].filter((r) => r.test(t)).length;
  const lines = t.split(/\n/).filter((l) => l.trim()).length;
  return fieldHits >= 2 && (lines >= 2 || t.length >= 40);
}

/** Última msg do agente = espelho de confirmação de recibo. */
export function assistantSentReceiptConfirmationMirror(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  if (/\bconfira os dados\b/i.test(t) && /\brecibo\b/i.test(t) && /🏨/.test(t)) return true;
  if (!/\brecibo\b/i.test(t)) return false;
  if (
    !/\b(?:confirme|confira|est[aá](?:\s+tudo)?\s+correto|correto\?|dados\s+(?:para|da|emiss[aã]o))\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return (
    /🏨|\bnome da hospedagem\b/i.test(t) &&
    (/🛏️|\bquarto\b/i.test(t) || /\braz[aã]o social\b/i.test(t))
  );
}

/** Turno de envio de dados do formulário recibo → espelho (ZERO tools). */
export function isReceiptFormSubmissionTurn(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
}): boolean {
  return (
    assistantSentReceiptDataForm(opts.lastAssistantMessage) &&
    userMessageLooksLikeReceiptFormSubmission(opts.userMessage)
  );
}

/** Última msg do agente = espelho de confirmação NF. */
export function assistantSentNfConfirmationMirror(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  if (!/\b(?:confirme|confira|est[aá](?:\s+tudo)?\s+correto|espelho|correto\?|dados\s+(?:para|da|emiss[aã]o))\b/i.test(t)) {
    return false;
  }
  return (
    /\b(?:nota\s+fiscal|\bnf\b|recibo)\b/i.test(t) &&
    [/\bnome\s+completo\b/i, /\bcpf\b/i, /\bcep\b/i, /\btelefone\b/i].filter((r) => r.test(t)).length >= 2
  );
}

/** `sim`/`ok` após espelho NF ou recibo → call_human (C19 passo 4 / 2b-b). */
export function shouldRequireCallHumanAfterNfConfirmation(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
}): boolean {
  const msg = (opts.userMessage ?? "").trim();
  if (!/^(sim|ok|okay|certo|confirmo|confirma|yes|yep|pode|est[aá]\s+correto|correto|isso|tudo\s+certo)$/i.test(msg)) {
    return false;
  }
  return (
    assistantSentNfConfirmationMirror(opts.lastAssistantMessage) ||
    assistantSentReceiptConfirmationMirror(opts.lastAssistantMessage)
  );
}

/** Turno de escolha de unidade após pedido NF/recibo (Passo 1→2 C19). */
export function isNfEstablishmentSelectionTurn(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): boolean {
  const last = (opts.lastAssistantMessage ?? "").trim();
  if (!last || !/\b(?:nota\s+fiscal|\bnf\b|recibo|comprovante|fatura)\b/i.test(last)) return false;
  if (!assistantRequestedEstablishmentForUnitKb(last)) return false;
  return Boolean(resolveEstablishmentInConversation(opts));
}

/**
 * Turno C19 com unidade resolvida — resposta determinística pós-KB.
 * Inclui NF+unidade na mesma mensagem (ex.: «solicitar NF no Hotel Brooklin»).
 */
export function isNfUnitKnowledgeReplyTurn(opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): boolean {
  if (isNfEstablishmentSelectionTurn(opts)) return true;
  const msg = (opts.userMessage ?? "").trim();
  if (!userMessageLooksLikeReceiptOrInvoiceRequest(msg)) return false;
  if (messageLooksLikeHumanHandoffRequest(msg)) return false;
  return Boolean(resolveEstablishmentInConversation(opts));
}

/** Agente pediu localizador (senha, check-in, etc.) — exceto fluxo C19 NF. */
export function assistantMentionedReservationLocator(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t || !/\blocalizador\b/i.test(t)) return false;
  if (assistantIsNfFlowTurn(t)) return false;
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

/** @deprecated C19 não usa mais localizador para auto-preenchimento. */
export function shouldRequireNfGuestLookupWithReservation(_opts: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
}): boolean {
  return false;
}

/** Hóspede enviou bloco preenchido da ficha FNRH (Legado — não é pergunta C16). */
export function userMessageLooksLikeFnrhFormSubmission(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  const lines = t.split(/\n/).filter((l) => l.trim()).length;
  const fieldHits = [
    /\bmotivo\b/i,
    /\btransporte\b/i,
    /\bmeio\s+de\s+transporte\b/i,
    /\bproced[eê]ncia\b/i,
    /\bdestino\b/i,
    /\bnacionalidade\b/i,
    /\bcpf\b/i,
  ].filter((r) => r.test(t)).length;
  const hasQuestion =
    /\?|como preencho|n[aã]o entendi|o que [eé]|qual [eé]|por que|porque|preciso saber/i.test(t);
  return fieldHits >= 2 && lines >= 2 && !hasQuestion;
}

/** Pergunta sobre FNRH / Embratur / ficha de viagem — GATE C16 (KB obrigatória). */
export function userMessageLooksLikeFnrhEmbraturQuestion(userMessage?: string | null): boolean {
  const t = (userMessage ?? "").trim();
  if (!t) return false;
  if (userMessageLooksLikeFnrhFormSubmission(t)) return false;
  if (messageIsStandaloneReservationLocator(t)) return false;
  if (
    /\bn[aã]o\s+quero\s+fazer\s+check[- ]?in\b/i.test(t) &&
    !/\b(?:fnrh|embratur|ficha|motivo\s+da\s+viagem|meio\s+de\s+transporte)\b/i.test(t)
  ) {
    return false;
  }
  const questionLike =
    /\?|como|o que|qual|por que|porque|preciso|obrigat|significa|para que|n[aã]o entendi|explic/i.test(
      t,
    );
  return (
    /\b(?:fnrh|embratur|ficha\s+(?:de\s+)?viagem|ficha\s+nacional|registro\s+de\s+h[oó]spedes)\b/i.test(
      t,
    ) ||
    /\bpor\s+que\s+(?:tantos\s+)?dados\b/i.test(t) ||
    /\bdados\s+(?:da\s+)?(?:ficha|embratur|fnrh)\b/i.test(t) ||
    (questionLike &&
      /\b(?:motivo\s+(?:da\s+)?viagem|meio\s+de\s+transporte|transporte\s+utilizado|proced[eê]ncia|destino|nacionalidade|ficha)\b/i.test(
        t,
      )) ||
    (/\b(?:minist[eé]rio\s+do\s+turismo|lgpd)\b/i.test(t) &&
      /\b(?:ficha|dados|cadastro|check-in|fnrh|embratur)\b/i.test(t))
  );
}

/** Turno C16 — consulta KB FNRH Digital antes de responder. */
export function shouldRequireFnrhKnowledgeLookupThisTurn(opts: {
  userMessage?: string | null;
}): boolean {
  return userMessageLooksLikeFnrhEmbraturQuestion(opts.userMessage);
}
