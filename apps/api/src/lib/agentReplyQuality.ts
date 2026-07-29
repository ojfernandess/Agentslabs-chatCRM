const STALL_RE =
  /\b(vou|irei)\s+.{0,48}?(verificar|consultar|buscar|pesquisar|checar|olhar|prosseguir|continuar|finalizar|concluir|processar)\b|\b(um\s+momento|só\s+um\s+momento|aguarde|já\s+volto|espere|momento\s+por\s+favor|momento\s+por\s+gentileza)\b|\b(enquanto)\s+.{0,40}?(finaliz|process|consult|verific)\b|\b(consultando|verificando|processando|finalizando)\b|\b(i'?ll|i\s+will)\s+.{0,32}?(check|look\s+up|search|proceed|finish)\b|\b(one\s+moment|just\s+a\s+moment|please\s+hold)\b/i;

const TOOL_ROUNDS_EXHAUSTED_RE =
  /não\s+foi\s+possível\s+concluir\s+as\s+ações\s+automáticas\s+a\s+tempo/i;

/** Resposta curta só a “vou verificar” / “um momento”, sem conteúdo útil. */
export function isLikelyStallOnlyReply(text: string, configuredStallMessages?: string[]): boolean {
  const t = text.trim();
  if (!t) return false;
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
  if (t.length < 8 || t.length > 280) return false;
  if (/[.!?][\s\S]{40,}/.test(t)) return false;
  return STALL_RE.test(t);
}

export function hasSubstantiveAgentReplyToCustomer(
  text: string,
  configuredStallMessages?: string[],
): boolean {
  const t = text.trim();
  if (!t) return false;
  return !isLikelyStallOnlyReply(t, configuredStallMessages);
}

/** True quando a resposta ainda não entrega factos ao cliente (stall / fallback de teto de tools). */
export function isNonDeliveringAgentReply(text: string, configuredStallMessages?: string[]): boolean {
  const t = text.trim();
  if (!t) return true;
  return isLikelyStallOnlyReply(t, configuredStallMessages);
}
