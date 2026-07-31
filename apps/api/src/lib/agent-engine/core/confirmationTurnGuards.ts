/**
 * Guardas genéricas para turnos de confirmação (sim/ok/não).
 * Multi-segmento: usa sinais de playbook/slots/última resposta — sem hardcodar um hotel.
 */

import { messageLooksLikeQuoteDiscountObjection } from "../quote/quoteAvailabilityReply.js";

/** Mensagem do hóspede parece recolha de formulário pós-gate (ficha), não bloco titular/acompanhante. */
export function messageLooksLikePostGateFormData(userMessage: string): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;

  // Documento / CPF puro — não é formulário pós-gate.
  if (/^\d{11}$/.test(msg)) return false;
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(msg)) return false;

  // Nacionalidade / gentílico curto.
  if (
    /^(brasileir[oa]|estrangeir[oa]|brasil|brazilian|foreigner|[a-záàâãéêíóôõúç]{4,20})$/i.test(
      msg,
    )
  ) {
    return false;
  }

  // Localizador curto isolado.
  if (/^[A-Z0-9]{6,12}$/i.test(msg) && /\d/.test(msg) && !/\s/.test(msg)) return false;

  // Bloco pessoal (titular/acompanhante) NÃO arma conclusão — só a ficha Embratur.
  if (
    /\b(nome\s+completo|rg\s*e\s*[oó]rg[aã]o|data\s+de\s+nascimento|cpf\s*\(|celular\s+com\s+ddd)\b/i.test(
      msg,
    ) &&
    !/\b(motivo(?:\s+da\s+viagem)?|meio\s+de\s+transporte|transporte|ficha\s+de\s+viagem)\b/i.test(
      msg,
    )
  ) {
    return false;
  }

  // Só sinais explícitos da ficha (S9b) — não basta multi-linha genérico.
  return /\b(motivo(?:\s+da\s+viagem)?|meio\s+de\s+transporte|transporte|pa[ií]s\s+de\s+(?:resid|destino)|proced[eê]ncia|destino|ficha(?:\s+de\s+viagem)?)\b/i.test(
    msg,
  );
}

export function readPartySize(
  flowSlots?: Record<string, string | number | boolean> | null,
  memory?: Record<string, unknown> | null,
): number | null {
  if (flowSlots) {
    const raw = flowSlots.guestsQuantity ?? flowSlots.guests_quantity ?? flowSlots.N;
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (!memory || typeof memory !== "object") return null;
  const facts = memory.facts ?? memory.eilFacts;
  if (facts && typeof facts === "object") {
    const g = (facts as Record<string, unknown>).guestsQuantity;
    const v =
      g && typeof g === "object" && "value" in (g as object)
        ? (g as { value?: unknown }).value
        : g;
    const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Última msg do agente pede dados (nacionalidade/CPF/modelo) — "sim" não é C11 de espelho. */
export function assistantAsksPreConfirmationData(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    /nacionalidade|citizenship|brasileiro\s*\/\s*estrangeiro|informe\s+(?:a\s+)?sua\s+nacionalidade/i.test(
      t,
    ) ||
    /me\s+informe\s+seu\s+cpf|informe\s+seu\s+cpf|envie\s+(?:o\s+)?(?:seu\s+)?cpf|digite\s+(?:o\s+)?(?:seu\s+)?cpf/i.test(
      t,
    ) ||
    /modelo\s*s1|dados\s+da\s+(?:sua\s+)?reserva|localizador\s*:/i.test(t)
  );
}

/** Espelho / confirmação do titular. */
export function assistantIsTitularMirrorConfirm(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return /confirme\s+os\s+dados\s+do\s+titular|dados\s+do\s+titular|titular\s*:/i.test(t);
}

/** Espelho da ficha de viagem / passo pré-conclusão. */
export function assistantIsFichaMirrorConfirm(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return /ficha\s+de\s+viagem|confirme\s+os\s+dados\s+da\s+ficha|motivo\s+da\s+viagem/i.test(t);
}

/** Ack mínimo pós tool de conclusão (S10) — próximo turno é Passo 8, não novo gate. */
export function assistantIsPostCheckInAck(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    /check-in\s+foi\s+conclu[ií]do|em\s+seguida\s+envio|responda\s+ok\s+para/i.test(t) ||
    /opera[cç][aã]o t[eé]cnica .* conclu[ií]da/i.test(t)
  );
}

/** Espelho da ficha de viagem / passo pré-conclusão (ou ack pós check-in). */
export function assistantIsCompletionStepConfirm(lastAssistantMessage?: string | null): boolean {
  return (
    assistantIsFichaMirrorConfirm(lastAssistantMessage) ||
    assistantIsPostCheckInAck(lastAssistantMessage)
  );
}

/** Pergunta S4c (cadastrar acompanhante). */
export function assistantIsCompanionOptInPrompt(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    /deseja\s+cadastrar|acompanhante\(s\)\s+agora|cadastrar\s+o\(s\)\s+acompanhante/i.test(t) ||
    (/acompanhante/i.test(t) && /\b(sim\s*\/\s*n[aã]o|sim\/n[aã]o|\(sim\/n[aã]o\))\b/i.test(t))
  );
}

/** Espelho / confirmação do acompanhante (ainda S4c — próximo é S9, não S10). */
export function assistantIsCompanionMirrorConfirm(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return /confirme\s+os\s+dados\s+do\s+acompanhante|dados\s+do\s+acompanhante/i.test(t);
}

/** Modelo C6 Confirm — hóspede confirma dados antes de consultar disponibilidade (C6c). */
export function assistantIsQuoteAvailabilityConfirm(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  if (
    /posso consultar a disponibilidade|posso verificar a disponibilidade|consultar a disponibilidade\s*\?/i.test(
      t,
    )
  ) {
    return true;
  }
  return (
    /perfeito!\s*ent[aã]o temos/i.test(t) &&
    /est[aá]\s+tudo certo/i.test(t) &&
    /(?:propriedade|data de chegada|data de partida|quantidade de pessoas|🏢|📅|👤)/i.test(t)
  );
}

/** Modelo C6 Opções — lista de opções com preços (C6e). */
export function assistantIsQuoteOptionsList(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    /consultei a disponibilidade/i.test(t) &&
    /qual opção você prefere/i.test(t)
  );
}

/** Oferta de transferência para verificar desconto (C6f). */
export function assistantIsQuoteDiscountTransferOffer(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    /n[aã]o posso conceder descontos/i.test(t) &&
    /transferir.*equipe de atendimento/i.test(t) &&
    /deseja que eu fa[cç]a essa transfer[eê]ncia/i.test(t)
  );
}

/** Hóspede escolhe opção após Modelo C6 Opções (C6e). */
export function messageLooksLikeQuoteOptionChoice(userMessage?: string | null): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;
  if (/^(sim|ok|okay|certo|confirmo|confirma|yes|yep|pode|n[aã]o|nao)$/i.test(msg)) return false;
  if (messageLooksLikeQuoteDiscountObjection(msg)) return false;
  if (/^\d{11}$/.test(msg)) return false;
  if (/^[1-9]$/.test(msg)) return true;
  if (/^(?:op[cç][aã]o\s*)?[1-9]\b/i.test(msg)) return true;
  if (/\b(?:a\s+)?(?:primeir[ao]|segund[ao]|terceir[ao]|quart[ao])\b/i.test(msg)) return true;
  if (/\b(prefiro|quero|escolho|vou\s+(?:de|com)|(?:su[ií]te|quarto|apartamento|opcao|opção))\b/i.test(msg)) {
    return true;
  }
  if (msg.length <= 80 && /\b(?:op[cç]|n[úu]mero|item)\b/i.test(msg) && /\d/.test(msg)) return true;
  return false;
}

/** Mensagem curta de confirmação (sim/ok) — reutilizado por gates. */
export function isShortAffirmativeConfirmation(userMessage?: string | null): boolean {
  const msg = (userMessage ?? "").trim();
  return /^(sim|ok|okay|certo|confirmo|confirma|yes|yep|pode)$/i.test(msg);
}

/**
 * Turno de confirmação que deve ficar sem tools exclusivas de gate
 * (ex.: titular OK com N≥2 → pergunta acompanhante; ou "sim" fora de contexto C11).
 */
export function shouldSuppressConfirmationExclusiveTools(opts: {
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
  userMessage?: string;
  memory?: Record<string, unknown> | null;
}): boolean {
  if (assistantAsksPreConfirmationData(opts.lastAssistantMessage)) return true;
  if (assistantIsPostCheckInAck(opts.lastAssistantMessage)) return true;

  const party = readPartySize(opts.flowSlots, opts.memory);
  const msg = (opts.userMessage ?? "").trim();
  const isYes = isShortAffirmativeConfirmation(msg);

  // C6c: sim pós Modelo C6 Confirm → consulta disponibilidade (não suppress).
  if (isYes && assistantIsQuoteAvailabilityConfirm(opts.lastAssistantMessage)) {
    return false;
  }

  // C6f: sim pós oferta de transferência por desconto → call_human (não suppress).
  if (isYes && assistantIsQuoteDiscountTransferOffer(opts.lastAssistantMessage)) {
    return false;
  }

  // Titular mirror + N≥2 + "sim" → S4c (ZERO tools), não gate de Embratur.
  if (isYes && party != null && party >= 2 && assistantIsTitularMirrorConfirm(opts.lastAssistantMessage)) {
    return true;
  }

  // "Sim" na pergunta S4c → pedir dados do acompanhante (ZERO), não Embratur.
  if (isYes && assistantIsCompanionOptInPrompt(opts.lastAssistantMessage)) {
    return true;
  }

  // "Não" / recusa de cadastro de acompanhante → S9 (não suppress; Embratur exclusive).
  if (
    assistantIsCompanionOptInPrompt(opts.lastAssistantMessage) &&
    isCompanionRegistrationDeclined(msg)
  ) {
    return false;
  }

  return false;
}

/** Hóspede recusa cadastrar acompanhante (S4c). */
export function isCompanionRegistrationDeclined(userMessage?: string | null): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;
  if (/^(n[aã]o|nao|no|nop|nunca)$/i.test(msg)) return true;
  return (
    /\b(n[aã]o|nao)\s+(quero|desejo|preciso|vou)\b[\s\S]{0,40}acompanhante/i.test(msg) ||
    /\bsem\s+acompanhante\b|\bn[aã]o\s+cadastrar\b|\bs[oó]\s+(eu|o\s+titular)\b/i.test(msg) ||
    /\bn[aã]o\s+desejo\s+cadastrar\b/i.test(msg)
  );
}

/**
 * Só auto-exige tool de conclusão quando o contexto é o passo de conclusão
 * (ficha confirmada / pós-ack) — não no espelho do titular nem S4c.
 */
export function shouldAllowCompletionToolPromotion(opts: {
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): boolean {
  // Ack pós check-in → Passo 8 (nunca reexigir tool de conclusão).
  if (assistantIsPostCheckInAck(opts.lastAssistantMessage)) return false;

  if (assistantIsFichaMirrorConfirm(opts.lastAssistantMessage)) return true;

  // Sem última resposta: só confiar em ready explícito (caller ainda exige a flag).
  if (!(opts.lastAssistantMessage ?? "").trim()) return true;

  // Titular / S4c / acompanhante / pedido de dados → nunca promover conclusão.
  if (assistantIsTitularMirrorConfirm(opts.lastAssistantMessage)) return false;
  if (assistantIsCompanionOptInPrompt(opts.lastAssistantMessage)) return false;
  if (assistantIsCompanionMirrorConfirm(opts.lastAssistantMessage)) return false;
  if (assistantAsksPreConfirmationData(opts.lastAssistantMessage)) return false;

  return true;
}

export const SESSION_LAST_ASSISTANT_PREVIEW_KEY = "__lastAssistantPreview";

export function readLastAssistantPreview(
  memoryOrSlots?: Record<string, unknown> | null,
): string {
  if (!memoryOrSlots || typeof memoryOrSlots !== "object") return "";
  const slots = memoryOrSlots.flowSlots;
  if (slots && typeof slots === "object") {
    const fromSlots = (slots as Record<string, unknown>)[SESSION_LAST_ASSISTANT_PREVIEW_KEY];
    if (typeof fromSlots === "string" && fromSlots.trim()) return fromSlots.trim();
  }
  const direct = memoryOrSlots[SESSION_LAST_ASSISTANT_PREVIEW_KEY];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (typeof memoryOrSlots.lastReplyPreview === "string" && memoryOrSlots.lastReplyPreview.trim()) {
    return memoryOrSlots.lastReplyPreview.trim();
  }
  const nested = memoryOrSlots.agentEngineMemory;
  if (nested && typeof nested === "object") {
    const p = (nested as Record<string, unknown>).lastReplyPreview;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return "";
}
