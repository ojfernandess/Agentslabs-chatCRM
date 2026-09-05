import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { receiveDataNode, preprocessNode } from "./receiveData.js";
import { validateConfidenceNode } from "./validateConfidence.js";
import type { IntelligentTaggingGraphState } from "../types.js";

function baseState(partial: Partial<IntelligentTaggingGraphState> = {}): IntelligentTaggingGraphState {
  return {
    organizationId: "org",
    conversationId: "conv",
    contactId: "contact",
    contactName: "Ana",
    trigger: "manual",
    minConfidence: 0.85,
    maxTags: 5,
    language: "pt",
    privacyAccepted: true,
    tagCatalog: [{ id: "t1", name: "Suporte", color: "#000" }],
    existingTagNames: [],
    transcript: "Cliente: preciso de ajuda",
    metadataSummary: "status=OPEN",
    mem0Context: "",
    classifications: [],
    suggestedNewTags: [],
    autoApply: [],
    pendingReview: [],
    autoAppliedTagIds: [],
    startedAtMs: Date.now(),
    ...partial,
  };
}

describe("receiveDataNode", () => {
  it("rejects when privacy not accepted", () => {
    const out = receiveDataNode(baseState({ privacyAccepted: false }));
    assert.equal(out.error, "privacy_not_accepted");
  });

  it("rejects empty catalog", () => {
    const out = receiveDataNode(baseState({ tagCatalog: [] }));
    assert.equal(out.error, "empty_tag_catalog");
  });

  it("rejects empty transcript", () => {
    const out = receiveDataNode(baseState({ transcript: "  " }));
    assert.equal(out.error, "empty_transcript");
  });
});

describe("preprocessNode", () => {
  it("normalizes metadata and mem0 context", () => {
    const out = preprocessNode(baseState({ metadataSummary: "", mem0Context: "  ctx  " }));
    assert.equal(out.metadataSummary, "—");
    assert.equal(out.mem0Context, "ctx");
  });
});

describe("validateConfidenceNode", () => {
  it("splits classifications using minConfidence", () => {
    const out = validateConfidenceNode(
      baseState({
        classifications: [
          { tagId: "t1", tagName: "Suporte", confidence: 0.95, rationale: "", suggestedNewTag: false },
          { tagId: "t1", tagName: "Suporte", confidence: 0.6, rationale: "", suggestedNewTag: false },
        ],
      }),
    );
    assert.equal(out.autoApply?.length, 1);
    assert.equal(out.pendingReview?.length, 1);
  });
});
