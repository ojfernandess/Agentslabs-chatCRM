import type { TagClassification } from "../types.js";
import { DEFAULT_MIN_CONFIDENCE } from "../types.js";

export type TranscriptMessage = {
  id: string;
  direction: string;
  body: string | null;
  isPrivate: boolean | null;
};

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

  const lines: string[] = [];
  if (priorAgent) {
    const body = (priorAgent.body ?? "").trim();
    if (body) lines.push(`Atendente (pergunta anterior): ${body}`);
  }
  for (const m of inboundBlock) {
    const body = (m.body ?? "").trim();
    if (body) {
      lines.push(`Cliente (mensagem actual — classificar só com base nisto): ${body}`);
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
