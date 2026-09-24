import type { IntelligentTaggingGraphState } from "../types.js";
import { DURING_CONVERSATION_MIN_CONFIDENCE } from "../types.js";
import {
  extractCurrentCustomerMessage,
  filterAlreadyAppliedTags,
  filterClassificationsByMessageEvidence,
  splitByConfidence,
} from "./helpers.js";

export function validateConfidenceNode(
  state: IntelligentTaggingGraphState,
): Partial<IntelligentTaggingGraphState> {
  if (state.error) return {};

  let classifications = state.classifications;

  if (state.trigger === "during_conversation") {
    classifications = filterAlreadyAppliedTags(classifications, state.existingTagNames ?? []);
    const currentMessage = extractCurrentCustomerMessage(state.transcript);
    classifications = filterClassificationsByMessageEvidence(
      classifications,
      currentMessage,
      state.tagCatalog,
    );
  }

  const minConfidence =
    state.trigger === "during_conversation"
      ? Math.max(state.minConfidence, DURING_CONVERSATION_MIN_CONFIDENCE)
      : state.minConfidence;

  const { autoApply, pendingReview } = splitByConfidence(classifications, minConfidence);

  return {
    autoApply,
    pendingReview,
    suggestedNewTags: state.suggestedNewTags,
  };
}
