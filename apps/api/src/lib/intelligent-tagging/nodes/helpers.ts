import type { TagClassification } from "../types.js";
import { DEFAULT_MIN_CONFIDENCE } from "../types.js";

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
