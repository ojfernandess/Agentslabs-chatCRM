import type { IntelligentTaggingGraphState } from "../types.js";
import { filterAlreadyAppliedTags, splitByConfidence } from "./helpers.js";

export function validateConfidenceNode(
  state: IntelligentTaggingGraphState,
): Partial<IntelligentTaggingGraphState> {
  if (state.error) return {};

  const classifications =
    state.trigger === "during_conversation"
      ? filterAlreadyAppliedTags(state.classifications, state.existingTagNames ?? [])
      : state.classifications;

  const { autoApply, pendingReview } = splitByConfidence(classifications, state.minConfidence);

  return {
    autoApply,
    pendingReview,
    suggestedNewTags: state.suggestedNewTags,
  };
}
