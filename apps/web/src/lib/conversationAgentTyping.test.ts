import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyAgentTypingSignal, createAgentTypingModel } from "./conversationAgentTyping.js";

describe("applyAgentTypingSignal", () => {
  it("clears typing on handoff and ignores a later typing signal", () => {
    let model = createAgentTypingModel();
    model = applyAgentTypingSignal(model, {
      kind: "typing",
      conversationId: "c1",
      typing: true,
      botName: "Bot",
    });
    assert.equal(model.byConversation.get("c1")?.botName, "Bot");

    model = applyAgentTypingSignal(model, {
      kind: "handoff",
      conversationId: "c1",
      awaitingHumanHandoff: true,
    });
    assert.equal(model.byConversation.has("c1"), false);

    const afterLateTyping = applyAgentTypingSignal(model, {
      kind: "typing",
      conversationId: "c1",
      typing: true,
      botName: "Bot",
    });
    assert.equal(afterLateTyping, model);
    assert.equal(afterLateTyping.byConversation.has("c1"), false);
  });

  it("allows typing again after handoff is cleared", () => {
    let model = createAgentTypingModel();
    model = applyAgentTypingSignal(model, {
      kind: "handoff",
      conversationId: "c1",
      awaitingHumanHandoff: true,
    });
    model = applyAgentTypingSignal(model, {
      kind: "handoff",
      conversationId: "c1",
      awaitingHumanHandoff: false,
    });
    model = applyAgentTypingSignal(model, {
      kind: "typing",
      conversationId: "c1",
      typing: true,
      botName: "Bot",
    });
    assert.equal(model.byConversation.get("c1")?.botName, "Bot");
  });

  it("still clears on an outbound message before handoff", () => {
    let model = createAgentTypingModel();
    model = applyAgentTypingSignal(model, {
      kind: "typing",
      conversationId: "c1",
      typing: true,
      botName: "Bot",
    });
    model = applyAgentTypingSignal(model, { kind: "outbound", conversationId: "c1" });
    assert.equal(model.byConversation.has("c1"), false);
    model = applyAgentTypingSignal(model, {
      kind: "typing",
      conversationId: "c1",
      typing: true,
      botName: "Bot",
    });
    assert.equal(model.byConversation.has("c1"), true);
  });
});
