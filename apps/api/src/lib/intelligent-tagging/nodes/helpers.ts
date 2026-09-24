import type { TagClassification } from "../types.js";
import { DEFAULT_MIN_CONFIDENCE } from "../types.js";

export type TranscriptMessage = {
  id: string;
  direction: string;
  body: string | null;
  isPrivate: boolean | null;
};

export type TagCatalogEntryWithHint = {
  id: string;
  name: string;
  hint: string;
};

function normalizeTagText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeTagText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/** Dica semântica derivada do nome da etiqueta (sem campo extra na BD). */
export function inferTagUsageHint(tagName: string): string {
  const n = normalizeTagText(tagName);
  if (/cotac|orcament|proposta|preco|valores|tabela|simulac/.test(n)) {
    return "Cliente pede preço, orçamento, cotação, proposta ou simulação comercial.";
  }
  if (/reclam|insatisf|cancel|procon|indign|absurdo|pessimo|horrivel/.test(n)) {
    return "Reclamação, insatisfação, ameaça de cancelamento ou problema grave de atendimento.";
  }
  if (/duvida|informac|como funciona|ajuda|faq|orient|esclarec|pergunta/.test(n)) {
    return "Dúvida ou pedido de informação/esclarecimento (sem reclamação nem pedido de preço).";
  }
  if (/suporte|tecnico|defeito|nao funciona|erro|bug|instal|configur/.test(n)) {
    return "Problema técnico, defeito, erro ou suporte operacional.";
  }
  if (/venda|comercial|negoci|fechamento|contrat|interesse/.test(n)) {
    return "Intenção comercial ou interesse de compra/contratação (não confundir com mera cotação).";
  }
  if (/agend|marcar|reserv|visita|horario|data/.test(n)) {
    return "Agendamento, reserva, visita ou marcação de horário.";
  }
  if (/pagament|fatura|boleto|pix|cobran|venciment/.test(n)) {
    return "Pagamento, fatura, boleto, cobrança ou vencimento.";
  }
  if (/entrega|prazo|envio|frete|logistic/.test(n)) {
    return "Entrega, prazo, envio ou logística.";
  }
  return "Usar apenas se o tema da mensagem actual corresponder claramente ao nome da etiqueta.";
}

export function enrichTagCatalogForLlm(
  catalog: Array<{ id: string; name: string }>,
): TagCatalogEntryWithHint[] {
  return catalog.map((tag) => ({
    id: tag.id,
    name: tag.name,
    hint: inferTagUsageHint(tag.name),
  }));
}

const MESSAGE_INTENT_PATTERNS: Array<{ id: string; patterns: RegExp[] }> = [
  {
    id: "quote",
    patterns: [
      /cotac|orcament|preco|valor|quanto cust|tabela|proposta|simulac|desconto|condicoes comerciais/,
    ],
  },
  {
    id: "complaint",
    patterns: [
      /reclam|insatisfe|pessimo|horrivel|absurdo|indign|procon|advogad|cancel|nunca mais|decepcion|raiva/,
    ],
  },
  {
    id: "question",
    patterns: [
      /duvida|como funciona|nao entend|pode explic|informa|saber se|qual e|o que e|como faco|onde fica/,
    ],
  },
  {
    id: "support",
    patterns: [/nao funciona|defeito|erro|bug|travou|quebrou|nao liga|nao abre|problema tecn/],
  },
  {
    id: "payment",
    patterns: [/pagament|fatura|boleto|pix|cobran|venciment|2 via|segunda via/],
  },
  {
    id: "scheduling",
    patterns: [/agend|marcar|reserv|visita|horario|data dispon|disponibilidade/],
  },
];

const TAG_INTENT_BY_HINT: Array<{ tagPattern: RegExp; intentId: string }> = [
  { tagPattern: /cotac|orcament|proposta|preco|valores|simulac/, intentId: "quote" },
  { tagPattern: /reclam|insatisf|cancel|procon|indign/, intentId: "complaint" },
  { tagPattern: /duvida|informac|ajuda|faq|orient|pergunta/, intentId: "question" },
  { tagPattern: /suporte|tecnico|defeito|erro|bug|instal/, intentId: "support" },
  { tagPattern: /pagament|fatura|boleto|pix|cobran/, intentId: "payment" },
  { tagPattern: /agend|marcar|reserv|visita|horario/, intentId: "scheduling" },
];

function detectMessageIntents(messageNorm: string): Set<string> {
  const intents = new Set<string>();
  for (const group of MESSAGE_INTENT_PATTERNS) {
    if (group.patterns.some((pattern) => pattern.test(messageNorm))) {
      intents.add(group.id);
    }
  }
  return intents;
}

function tagIntentIds(tagName: string): Set<string> {
  const n = normalizeTagText(tagName);
  const intents = new Set<string>();
  for (const row of TAG_INTENT_BY_HINT) {
    if (row.tagPattern.test(n)) intents.add(row.intentId);
  }
  return intents;
}

function longestCommonSubstringLength(a: string, b: string, minLen = 10): number {
  if (!a || !b) return 0;
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let len = 0;
      while (i + len < a.length && j + len < b.length && a[i + len] === b[j + len]) {
        len++;
      }
      if (len > best) best = len;
    }
  }
  return best >= minLen ? best : 0;
}

function hasTagNameTokenInMessage(tagName: string, messageNorm: string): boolean {
  const tagTokens = tokenize(tagName).filter((token) => token.length >= 4);
  return tagTokens.some((token) => messageNorm.includes(token));
}

/** Extrai o texto da(s) mensagem(ns) marcada(s) como «mensagem actual». */
export function extractCurrentCustomerMessage(transcript: string): string {
  const lines = transcript.split("\n").filter(Boolean);
  const chunks = lines
    .filter((line) => /mensagem actual/i.test(line))
    .map((line) => line.replace(/^Cliente \(mensagem actual[^:]*:\s*/i, "").trim())
    .filter(Boolean);
  return chunks.join(" ").trim();
}

/**
 * Descarta sugestões sem evidência no texto actual (modo during_conversation).
 * Reduz etiquetas genéricas ou fora de contexto.
 */
export function filterClassificationsByMessageEvidence(
  classifications: TagClassification[],
  currentMessage: string,
  tagCatalog: Array<{ id: string; name: string }>,
): TagClassification[] {
  const messageNorm = normalizeTagText(currentMessage);
  if (!messageNorm) return [];

  const messageIntents = detectMessageIntents(messageNorm);
  const rationaleNorm = (value: string) => normalizeTagText(value);

  return classifications.filter((classification) => {
    if (classification.suggestedNewTag || !classification.tagId) return true;

    const tag = tagCatalog.find((row) => row.id === classification.tagId);
    if (!tag) return false;

    const tagIntents = tagIntentIds(tag.name);
    if (tagIntents.size > 0 && messageIntents.size > 0) {
      for (const intent of tagIntents) {
        if (messageIntents.has(intent)) return true;
      }
      return false;
    }

    if (hasTagNameTokenInMessage(tag.name, messageNorm)) return true;

    const rat = rationaleNorm(classification.rationale);
    if (longestCommonSubstringLength(rat, messageNorm, 10) > 0) return true;

    if (classification.confidence >= 0.94 && rat.length >= 24) {
      const hintTokens = tokenize(inferTagUsageHint(tag.name));
      if (hintTokens.some((token) => token.length >= 5 && messageNorm.includes(token))) return true;
    }

    return false;
  });
}

/** Transcript focado na mensagem inbound que disparou a etiquetagem (modo during_conversation). */
export function buildDuringConversationTranscript(
  messages: TranscriptMessage[],
  triggerMessageId?: string,
): string {
  if (!messages.length) return "";

  let triggerIdx = -1;
  if (triggerMessageId) {
    triggerIdx = messages.findIndex((m) => m.id === triggerMessageId);
  }
  if (triggerIdx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.direction === "INBOUND" && !m.isPrivate) {
        triggerIdx = i;
        break;
      }
    }
  }
  if (triggerIdx < 0) return "";

  const inboundBlock: TranscriptMessage[] = [];
  for (let i = triggerIdx; i >= 0; i--) {
    const m = messages[i];
    if (m.isPrivate) continue;
    if (m.direction === "INBOUND") {
      inboundBlock.unshift(m);
    } else if (inboundBlock.length > 0) {
      break;
    }
  }
  if (!inboundBlock.length) return "";

  const blockStartIdx = messages.findIndex((m) => m.id === inboundBlock[0]!.id);
  let priorAgent: TranscriptMessage | null = null;
  if (blockStartIdx > 0) {
    for (let i = blockStartIdx - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.isPrivate) continue;
      if (m.direction === "OUTBOUND") {
        priorAgent = m;
        break;
      }
      if (m.direction === "INBOUND") break;
    }
  }

  const contextLines: string[] = [];
  const contextStart = Math.max(0, blockStartIdx - 4);
  for (let i = contextStart; i < blockStartIdx; i++) {
    const m = messages[i];
    if (m.isPrivate) continue;
    const body = (m.body ?? "").trim();
    if (!body) continue;
    const label = m.direction === "INBOUND" ? "Cliente" : "Atendente";
    contextLines.push(`${label}: ${body}`);
  }

  const lines: string[] = [];
  if (contextLines.length) {
    lines.push("Contexto anterior (NÃO usar para escolher etiquetas — só desambiguação):");
    lines.push(...contextLines.slice(-3));
    lines.push("");
  }
  if (priorAgent) {
    const body = (priorAgent.body ?? "").trim();
    if (body) lines.push(`Atendente (pergunta imediatamente anterior): ${body}`);
  }
  lines.push("--- Mensagem(ns) do cliente a classificar ---");
  for (const m of inboundBlock) {
    const body = (m.body ?? "").trim();
    if (body) {
      lines.push(`Cliente (mensagem actual — classificar SÓ com base nisto): ${body}`);
    }
  }
  return lines.join("\n");
}

export function filterAlreadyAppliedTags(
  classifications: TagClassification[],
  existingTagNames: string[],
): TagClassification[] {
  const existing = new Set(existingTagNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (!existing.size) return classifications;
  return classifications.filter((c) => !existing.has(c.tagName.trim().toLowerCase()));
}

export function splitByConfidence(
  classifications: TagClassification[],
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
): { autoApply: TagClassification[]; pendingReview: TagClassification[] } {
  const autoApply: TagClassification[] = [];
  const pendingReview: TagClassification[] = [];

  for (const c of classifications) {
    if (c.suggestedNewTag || !c.tagId) {
      pendingReview.push(c);
      continue;
    }
    if (c.confidence >= minConfidence) {
      autoApply.push(c);
    } else {
      pendingReview.push(c);
    }
  }

  return { autoApply, pendingReview };
}

export function normalizeConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function parseLlmTaggingResponse(
  raw: unknown,
  tagCatalog: Array<{ id: string; name: string }>,
): { classifications: TagClassification[]; suggestedNewTags: string[] } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const byName = new Map(tagCatalog.map((t) => [t.name.trim().toLowerCase(), t]));
  const byId = new Map(tagCatalog.map((t) => [t.id, t]));

  const rawTags = Array.isArray(o.tags) ? o.tags : [];
  const classifications: TagClassification[] = [];
  const suggestedNewTags: string[] = [];

  for (const item of rawTags) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const confidence = normalizeConfidence(row.confidence);
    const rationale = typeof row.rationale === "string" ? row.rationale.trim().slice(0, 500) : "";
    const tagIdRaw = typeof row.tagId === "string" ? row.tagId.trim() : "";
    const tagNameRaw = typeof row.tagName === "string" ? row.tagName.trim() : "";

    let tagId: string | null = null;
    let tagName = tagNameRaw;

    if (tagIdRaw && byId.has(tagIdRaw)) {
      tagId = tagIdRaw;
      tagName = byId.get(tagIdRaw)!.name;
    } else if (tagNameRaw) {
      const match = byName.get(tagNameRaw.toLowerCase());
      if (match) {
        tagId = match.id;
        tagName = match.name;
      }
    }

    const suggestedNewTag = Boolean(row.suggestedNewTag) || (!tagId && tagName.length > 0);
    if (suggestedNewTag && tagName) {
      suggestedNewTags.push(tagName);
    }

    if (!tagName && !tagId) continue;

    classifications.push({
      tagId,
      tagName: tagName || byId.get(tagId!)?.name || "—",
      confidence,
      rationale,
      suggestedNewTag,
    });
  }

  const extra = Array.isArray(o.suggestedNewTags) ? o.suggestedNewTags : [];
  for (const s of extra) {
    if (typeof s === "string" && s.trim()) suggestedNewTags.push(s.trim());
  }

  return {
    classifications,
    suggestedNewTags: [...new Set(suggestedNewTags.map((s) => s.slice(0, 120)))],
  };
}

export function buildMetadataSummary(input: {
  status?: string;
  priority?: string | null;
  inboxName?: string;
  pipelineStage?: string | null;
  attachmentCount?: number;
}): string {
  const parts: string[] = [];
  if (input.status) parts.push(`status=${input.status}`);
  if (input.priority) parts.push(`priority=${input.priority}`);
  if (input.inboxName) parts.push(`inbox=${input.inboxName}`);
  if (input.pipelineStage) parts.push(`pipeline=${input.pipelineStage}`);
  if (input.attachmentCount != null) parts.push(`attachments=${input.attachmentCount}`);
  return parts.join("; ") || "—";
}
