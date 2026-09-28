import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversationUpdateHasStructuralChange } from "./conversationUpdatedStructuralChange.js";

describe("conversationUpdateHasStructuralChange", () => {
  it("returns false for message-only updates (conversationId only)", () => {
    assert.equal(
      conversationUpdateHasStructuralChange({ conversationId: "c-1" }),
      false,
    );
  });

  it("returns true when status changes", () => {
    assert.equal(
      conversationUpdateHasStructuralChange({ conversationId: "c-1", status: "OPEN" }),
      true,
    );
  });

  it("returns true when assignee changes", () => {
    assert.equal(
      conversationUpdateHasStructuralChange({ conversationId: "c-1", assignedToId: null }),
      true,
    );
  });
});
