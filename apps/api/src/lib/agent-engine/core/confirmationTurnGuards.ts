/**
 * Guardas genéricas para turnos de confirmação (sim/ok/não).
 * Multi-segmento: usa sinais de playbook/slots/última resposta — sem hardcodar um hotel.
 */

/** Mensagem do hóspede parece recolha de formulário pós-gate (não CPF/nacionalidade curta). */
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

  const lines = msg.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) return true;
  if (/\*\s*\w+\s*:/.test(msg) && lines.length >= 2) return true;
  if (
    /\b(motivo|transporte|meio\s+de\s+transporte|pa[ií]s|cidade|proced[eê]ncia|destino|ficha)\b/i.test(
      msg,
    )
  ) {
    return true;
  }
  // Bloco com vários "campo: valor"
  const kv = (msg.match(/^\s*[\wÀ-ú* ]{2,40}\s*[:=]/gim) ?? []).length;
  if (kv >= 3) return true;

  return false;
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
export function assistantIsCompletionStepConfirm(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return (
    /ficha\s+de\s+viagem|confirme\s+os\s+dados\s+da\s+ficha|motivo\s+da\s+viagem/i.test(t) ||
    /check-in\s+foi\s+conclu[ií]do|em\s+seguida\s+envio|responda\s+ok\s+para/i.test(t)
  );
}

/** Pergunta S4c (cadastrar acompanhante). */
export function assistantIsCompanionOptInPrompt(lastAssistantMessage?: string | null): boolean {
  const t = (lastAssistantMessage ?? "").trim();
  if (!t) return false;
  return /deseja\s+cadastrar|acompanhante\(s\)\s+agora|cadastrar\s+o\(s\)\s+acompanhante/i.test(t);
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

  const party = readPartySize(opts.flowSlots, opts.memory);
  const msg = (opts.userMessage ?? "").trim();
  const isYes = /^(sim|ok|okay|certo|confirmo|confirma|yes|yep)$/i.test(msg);

  // Titular mirror + N≥2 + "sim" → S4c (ZERO tools), não gate de Embratur.
  if (isYes && party != null && party >= 2 && assistantIsTitularMirrorConfirm(opts.lastAssistantMessage)) {
    return true;
  }

  // "Sim" na pergunta S4c → pedir dados do acompanhante (ZERO), não Embratur.
  if (isYes && assistantIsCompanionOptInPrompt(opts.lastAssistantMessage)) {
    return true;
  }

  return false;
}

/**
 * Só auto-exige tool de conclusão quando o contexto é o passo de conclusão
 * (ficha confirmada / pós-ack) — não no espelho do titular nem S4c.
 */
export function shouldAllowCompletionToolPromotion(opts: {
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean> | null;
}): boolean {
  if (assistantIsCompletionStepConfirm(opts.lastAssistantMessage)) return true;

  // Sem última resposta: só confiar em ready explícito (caller ainda exige a flag).
  if (!(opts.lastAssistantMessage ?? "").trim()) return true;

  // Titular / S4c / pedido de dados → nunca promover conclusão.
  if (assistantIsTitularMirrorConfirm(opts.lastAssistantMessage)) return false;
  if (assistantIsCompanionOptInPrompt(opts.lastAssistantMessage)) return false;
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
