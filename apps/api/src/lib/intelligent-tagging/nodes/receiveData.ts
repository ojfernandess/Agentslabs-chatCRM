import type { IntelligentTaggingGraphState } from "../types.js";

export function receiveDataNode(
  state: IntelligentTaggingGraphState,
): Partial<IntelligentTaggingGraphState> {
  if (!state.privacyAccepted) {
    return { error: "privacy_not_accepted" };
  }
  if (!state.tagCatalog.length) {
    return { error: "empty_tag_catalog" };
  }
  if (!state.transcript.trim()) {
    return { error: "empty_transcript" };
  }
  return {};
}

export function preprocessNode(
  state: IntelligentTaggingGraphState,
): Partial<IntelligentTaggingGraphState> {
  return {
    existingTagNames: state.existingTagNames ?? [],
    mem0Context: state.mem0Context?.trim() ?? "",
    metadataSummary: state.metadataSummary?.trim() || "—",
  };
}
