import type { IntelligentTaggingGraphState } from "../types.js";
import { splitByConfidence } from "./helpers.js";

export function validateConfidenceNode(
  state: IntelligentTaggingGraphState,
): Partial<IntelligentTaggingGraphState> {
  if (state.error) return {};

  const { autoApply, pendingReview } = splitByConfidence(
    state.classifications,
    state.minConfidence,
  );

  return {
    autoApply,
    pendingReview,
    suggestedNewTags: state.suggestedNewTags,
  };
}
