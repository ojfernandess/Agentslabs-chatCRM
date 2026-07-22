import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNativeFlowStatePromptBlock,
  extractFlowSlotsFromToolExchange,
  parseAutomationContextState,
} from "./automationConversationContextLib.js";

test("parseAutomationContextState keeps lastNativeToolRound without followUpCampaign", () => {
  const state = parseAutomationContextState({
    nativeTurn: {
      lastInboundMessageId: "m1",
      lastInboundAt: "2026-01-01T00:00:00.000Z",
      lastPreview: "oi",
    },
    lastNativeToolRound: {
      at: "2026-01-01T00:01:00.000Z",
      toolCount: 1,
      tools: [{ name: "upload", ok: true, preview: '{"id":"u1"}' }],
      resultDeliveredToCustomer: true,
    },
    flowSlots: { reservationIdOrLocalizer: "ABC123", approveCheckin: true },
    flowStep: "awaiting_selfie",
  });
  assert.equal(state.nativeTurn?.lastInboundMessageId, "m1");
  assert.equal(state.lastNativeToolRound?.tools[0]?.name, "upload");
  assert.equal(state.flowSlots?.reservationIdOrLocalizer, "ABC123");
  assert.equal(state.flowSlots?.approveCheckin, true);
  assert.equal(state.flowStep, "awaiting_selfie");
});

test("extractFlowSlotsFromToolExchange captures scalars and response ids", () => {
  const slots = extractFlowSlotsFromToolExchange({
    llmArgs: { reservationIdOrLocalizer: "A3FIULCZ", type: "document" },
    responseText: JSON.stringify({ ok: true, data: { documentPhotoUrl: "https://cdn/x.jpg", id: "doc-9" } }),
    ok: true,
  });
  assert.equal(slots.reservationIdOrLocalizer, "A3FIULCZ");
  assert.equal(slots.type, "document");
  assert.equal(slots.documentPhotoUrl, "https://cdn/x.jpg");
  assert.equal(slots.id, "doc-9");
});

test("buildNativeFlowStatePromptBlock includes slots and last tools", () => {
  const block = buildNativeFlowStatePromptBlock({
    flowStep: "uploaded_doc",
    flowSlots: { reservationIdOrLocalizer: "X1" },
    lastNativeToolRound: {
      at: "2026-01-01T00:00:00.000Z",
      toolCount: 1,
      tools: [{ name: "upload", ok: true, preview: "ok" }],
      resultDeliveredToCustomer: true,
    },
  });
  assert.match(block, /estado do fluxo/);
  assert.match(block, /reservationIdOrLocalizer/);
  assert.match(block, /upload/);
});
