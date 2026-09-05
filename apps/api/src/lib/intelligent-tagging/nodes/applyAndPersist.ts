import { randomUUID } from "node:crypto";
import type { IntelligentTagSuggestionStatus } from "@prisma/client";
import { prisma } from "../../../db.js";
import { assignTagsToConversationContact } from "../../assignContactTags.js";
import { emitTaggingObservability } from "../observability.js";
import type { IntelligentTaggingGraphState, TagClassification } from "../types.js";

function suggestionRows(
  items: TagClassification[],
  status: IntelligentTagSuggestionStatus,
): Array<{
  tagId: string | null;
  tagName: string;
  suggestedNewTag: boolean;
  confidence: number;
  rationale: string | null;
  status: IntelligentTagSuggestionStatus;
}> {
  return items.map((c) => ({
    tagId: c.tagId,
    tagName: c.tagName,
    suggestedNewTag: c.suggestedNewTag,
    confidence: c.confidence,
    rationale: c.rationale || null,
    status,
  }));
}

export async function applyAndPersistNode(
  state: IntelligentTaggingGraphState,
): Promise<Partial<IntelligentTaggingGraphState>> {
  const runId = randomUUID();
  const latencyMs = Date.now() - state.startedAtMs;
  const autoAppliedCount = state.error ? 0 : state.autoApply.length;
  const pendingReviewCount = state.error ? 0 : state.pendingReview.length;

  let autoAppliedTagIds: string[] = [];
  if (!state.error && state.autoApply.length) {
    const tagIds = state.autoApply.map((c) => c.tagId).filter((id): id is string => Boolean(id));
    if (tagIds.length) {
      const applied = await assignTagsToConversationContact(prisma, {
        organizationId: state.organizationId,
        conversationId: state.conversationId,
        tagIds,
        mode: "add",
      });
      if (applied.ok) autoAppliedTagIds = tagIds;
    }
  }

  const traceId = await emitTaggingObservability(
    { ...state, autoAppliedTagIds, runId },
    { runId, latencyMs },
  );

  const autoRows = state.error ? [] : suggestionRows(state.autoApply, "AUTO_APPLIED");
  const pendingRows = state.error ? [] : suggestionRows(state.pendingReview, "PENDING");

  await prisma.intelligentTaggingRun.create({
    data: {
      id: runId,
      organizationId: state.organizationId,
      conversationId: state.conversationId,
      trigger: state.trigger,
      latencyMs,
      autoAppliedCount: autoAppliedTagIds.length,
      pendingReviewCount: pendingRows.length,
      modelUsed: state.modelUsed ?? null,
      traceId,
      metadata: {
        error: state.error ?? null,
        suggestedNewTags: state.suggestedNewTags,
        initiatedByUserId: state.initiatedByUserId ?? null,
      },
      suggestions: {
        create: [...autoRows, ...pendingRows].map((row) => ({
          organizationId: state.organizationId,
          conversationId: state.conversationId,
          ...row,
        })),
      },
    },
  });

  return { runId, autoAppliedTagIds };
}
