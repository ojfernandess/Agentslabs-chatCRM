import type { Prisma } from "@prisma/client";

/** Corte temporal partilhado após «Limpar contexto» ou encerramento com reset de automação. */
export function nativeAgentHistoryCreatedAtFilter(
  lastClearedAt: Date | null,
): Prisma.DateTimeFilter | undefined {
  if (!lastClearedAt) return undefined;
  return { gt: lastClearedAt };
}

/**
 * Filtro Prisma para mensagens enviadas ao agente nativo.
 * Quando `lastClearedAt` está definido (após «Limpar contexto» na automação), exclui mensagens
 * anteriores a essa data — o modelo deixa de ver o histórico antigo (as mensagens na BD mantêm-se).
 * Exclui notas internas (`isPrivate`) para não contaminar o prompt com transferências anteriores.
 */
export function buildNativeAgentMessageWhere(input: {
  conversationId: string;
  excludeMessageId: string;
  lastClearedAt: Date | null;
}): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {
    conversationId: input.conversationId,
    id: { not: input.excludeMessageId },
    isPrivate: false,
  };
  const createdAt = nativeAgentHistoryCreatedAtFilter(input.lastClearedAt);
  if (createdAt) where.createdAt = createdAt;
  return where;
}

/** Transcript público (handoff, assist) respeitando o mesmo corte de contexto do agente nativo. */
export function buildNativeAgentTranscriptWhere(input: {
  conversationId: string;
  lastClearedAt: Date | null;
}): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {
    conversationId: input.conversationId,
    isPrivate: false,
  };
  const createdAt = nativeAgentHistoryCreatedAtFilter(input.lastClearedAt);
  if (createdAt) where.createdAt = createdAt;
  return where;
}

/** Mídia inbound disponível para tools HTTP — só após o último «Limpar contexto». */
export function buildNativeAgentInboundMediaWhere(input: {
  conversationId: string;
  lastClearedAt: Date | null;
}): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = {
    conversationId: input.conversationId,
    direction: "INBOUND",
    mediaUrl: { not: null },
    type: { in: ["IMAGE", "DOCUMENT", "VIDEO", "AUDIO"] },
  };
  const createdAt = nativeAgentHistoryCreatedAtFilter(input.lastClearedAt);
  if (createdAt) where.createdAt = createdAt;
  return where;
}

export type NativeAgentHistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * Agentes com ferramentas HTTP/Webhook ligadas (modo automático) não devem
 * reutilizar o histórico da conversa como contexto do LLM — evita misturar
 * dados de outro hóspede/localizador na mesma thread (ex.: check-in).
 */
export function shouldIsolateHistoryForConnectedTools(connectedAutoHttpToolCount: number): boolean {
  return connectedAutoHttpToolCount > 0;
}

/**
 * Resolve os turnos enviados ao modelo.
 * - Com isolamento por tools: devolve histórico vazio (a mensagem actual vai no user turn).
 * - `historyOverride` (test-chat) prevalece e não é esvaziado.
 */
export function resolveNativeAgentHistoryTurns(input: {
  loadedHistory: NativeAgentHistoryTurn[];
  historyOverride?: NativeAgentHistoryTurn[] | null;
  isolateForConnectedTools: boolean;
}): { history: NativeAgentHistoryTurn[]; isolated: boolean } {
  if (input.historyOverride != null) {
    return { history: input.historyOverride, isolated: false };
  }
  if (input.isolateForConnectedTools) {
    return { history: [], isolated: true };
  }
  return { history: input.loadedHistory, isolated: false };
}

/** Tokens de identidade no texto do cliente (localizador, CPF, códigos). */
export function extractIdentityTokensFromUserMessage(userMessage: string): string[] {
  const t = userMessage.trim();
  if (!t) return [];
  const out = new Set<string>();
  const compact = t.replace(/\s+/g, "");
  if (/^[A-Z0-9]{5,14}$/i.test(compact)) {
    out.add(compact.toUpperCase());
  }
  const digitsOnly = compact.replace(/\D/g, "");
  if (digitsOnly.length >= 8 && digitsOnly.length <= 14 && /^[\d.\-\/]+$/.test(compact)) {
    out.add(digitsOnly);
  }
  for (const m of t.match(/\b[A-Z0-9]{5,14}\b/gi) ?? []) {
    // Exige pelo menos 1 dígito para não confundir palavras («Imagem», «cliente») com localizadores.
    if (/\d/.test(m)) out.add(m.toUpperCase());
  }
  for (const m of t.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) ?? []) {
    out.add(m.replace(/\D/g, ""));
  }
  return [...out];
}

function normalizeIdentityValue(raw: string): { alnum: string; digits: string } {
  const s = raw.trim();
  return {
    alnum: s.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    digits: s.replace(/\D/g, ""),
  };
}

function isIdentitySlotKey(key: string): boolean {
  return /localizer|locator|reservation|booking|confirmation|cpf|document|guest|hospede|hóspede|check[_-]?in|codigo|código/i.test(
    key,
  );
}

function identityValuesMatch(stored: string, token: string): boolean {
  const a = normalizeIdentityValue(stored);
  const b = normalizeIdentityValue(token);
  if (!a.alnum || !b.alnum) return false;
  if (a.alnum === b.alnum) return true;
  if (a.digits.length >= 8 && a.digits === b.digits) return true;
  if (a.alnum.includes(b.alnum) || b.alnum.includes(a.alnum)) return true;
  return false;
}

/**
 * Detecta se a mensagem actual traz um identificador diferente do guardado em flowSlots
 * (ex.: novo localizador após check-in de outro hóspede na mesma conversa).
 */
export function flowSlotsConflictWithUserIdentity(
  flowSlots: Record<string, string | number | boolean> | undefined,
  userMessage: string,
): boolean {
  if (!flowSlots || Object.keys(flowSlots).length === 0) return false;
  const tokens = extractIdentityTokensFromUserMessage(userMessage);
  if (tokens.length === 0) return false;
  const stored = Object.entries(flowSlots)
    .filter(([k]) => isIdentitySlotKey(k))
    .map(([, v]) => String(v).trim())
    .filter(Boolean);
  if (stored.length === 0) return false;
  const anyMatch = tokens.some((tok) => stored.some((sv) => identityValuesMatch(sv, tok)));
  return !anyMatch;
}
