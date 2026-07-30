/**
 * Qualidade da reply ao contacto — stall + narracao de tool pendente.
 * Usado pelo Motor Padrao apos ACT (Scheduler) para nunca enviar
 * «Vou consultar… (Invocando a ferramenta)» como resposta final.
 */

const STALL_RE =
  /\b(vou|irei)\s+.{0,48}?(verificar|consultar|buscar|pesquisar|checar|olhar|prosseguir|continuar|finalizar|concluir|processar)\b|\b(um\s+momento|só\s+um\s+momento|aguarde|já\s+volto|espere|momento\s+por\s+favor|momento\s+por\s+gentileza)\b|\b(enquanto)\s+.{0,40}?(finaliz|process|consult|verific)\b|\b(consultando|verificando|processando|finalizando)\b|\b(i'?ll|i\s+will)\s+.{0,32}?(check|look\s+up|search|proceed|finish)\b|\b(one\s+moment|just\s+a\s+moment|please\s+hold)\b/i;

const TOOL_ROUNDS_EXHAUSTED_RE =
  /não\s+foi\s+possível\s+concluir\s+as\s+ações\s+automáticas\s+a\s+tempo/i;

/** Narracao de invocacao pendente (ex.: execucao 11:31). */
const TOOL_NARRATION_RE =
  /\(\s*invocando\s+a\s+ferramenta\b|invocando\s+a\s+ferramenta\s*[`'"]?\w|#{1,3}\s*consultando\s+a\s+reserva|consultando\s+a\s+reserva\s*\.{0,3}\s*$|chame\s+`?[a-z0-9_-]*consultar|vou\s+(consultar|verificar|chamar|invocar)\b.{0,80}\b(ferramenta|tool|reserva)/i;

/**
 * True quando a reply narra chamada de tool / «consultando…» em vez de entregar factos.
 * Independente do comprimento — o formato 11:31 tinha ~179 chars com markdown.
 */
export function isToolNarrationReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (TOOL_NARRATION_RE.test(t)) return true;
  // Markdown heading + tool name backtick sem dados de estadia
  if (/#{1,3}\s*.{0,40}(consult|verific|invoc)/i.test(t) && /`[a-z0-9_-]{4,}`/i.test(t)) {
    if (!/\b(hóspedes|hospedagem|check-in|check-out|nacionalidade)\b/i.test(t)) return true;
  }
  return false;
}

/** Resposta curta só a “vou verificar” / “um momento”, sem conteúdo útil. */
export function isLikelyStallOnlyReply(text: string, configuredStallMessages?: string[]): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isToolNarrationReply(t)) return true;
  if (TOOL_ROUNDS_EXHAUSTED_RE.test(t) && t.length < 220) return true;
  if (/^só\s+um\s+momento(\s+por\s+gentileza)?[.!…]?\s*$/i.test(t)) return true;
  if (/^um\s+momento([,.]\s*.{0,60})?[.!…]?\s*$/i.test(t)) return true;
  for (const raw of configuredStallMessages ?? []) {
    const m = raw.trim();
    if (m.length < 6) continue;
    if (t.toLowerCase() === m.toLowerCase()) return true;
    if (t.length <= Math.max(m.length + 24, 120) && t.toLowerCase().includes(m.toLowerCase()) && t.length < 200) {
      return true;
    }
  }
  if (t.length < 8) return false;
  // Narracao curta/media: nao isentar so por ter «. » + 40 chars (bug 11:31).
  if (STALL_RE.test(t) && t.length <= 400 && !hasReservationFactsInReply(t)) return true;
  if (t.length > 280) return false;
  if (/[.!?][\s\S]{40,}/.test(t) && !STALL_RE.test(t)) return false;
  return STALL_RE.test(t);
}

function hasReservationFactsInReply(text: string): boolean {
  return (
    /\b(hospedagem|hóspedes|check-in|check-out|nacionalidade|brasileiro|estrangeiro)\b/i.test(text) &&
    /\d{1,2}[\/.\-]\d{1,2}|\d{4}-\d{2}-\d{2}|👥|📍|📅/.test(text)
  );
}

export function hasSubstantiveAgentReplyToCustomer(
  text: string,
  configuredStallMessages?: string[],
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isToolNarrationReply(t)) return false;
  return !isLikelyStallOnlyReply(t, configuredStallMessages);
}

/** True quando a resposta ainda nao entrega factos ao cliente. */
export function isNonDeliveringAgentReply(text: string, configuredStallMessages?: string[]): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isToolNarrationReply(t)) return true;
  return isLikelyStallOnlyReply(t, configuredStallMessages);
}

/** Bloco de sistema para turnos runtime_owned com tools ja executadas. */
export function buildRuntimeOwnedReplyGuardAppendix(): string {
  return (
    "\n\n[OpenConduit — Runtime owns tools]\n" +
    "As ferramentas obrigatorias **ja foram executadas** pelo Scheduler neste turno.\n" +
    "A sua resposta DEVE usar os factos/JSON abaixo e entregar o script do playbook ao cliente.\n" +
    "PROIBIDO: «Vou consultar/verificar…», «Um momento», «Consultando a reserva…», " +
    "«(Invocando a ferramenta …)», markdown de invocacao, ou fingir que ainda vai chamar tools.\n"
  );
}
