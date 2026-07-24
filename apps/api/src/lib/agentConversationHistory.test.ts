import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNativeAgentInboundMediaWhere,
  buildNativeAgentMessageWhere,
  buildNativeAgentTranscriptWhere,
  extractIdentityTokensFromUserMessage,
  flowSlotsConflictWithUserIdentity,
  resolveNativeAgentHistoryTurns,
  shouldIsolateHistoryForConnectedTools,
} from "./agentConversationHistory.js";

test("buildNativeAgentMessageWhere without clear is only conversation + exclude id", () => {
  const w = buildNativeAgentMessageWhere({
    conversationId: "c1",
    excludeMessageId: "m0",
    lastClearedAt: null,
  });
  assert.equal(w.conversationId, "c1");
  assert.deepEqual(w.id, { not: "m0" });
  assert.equal(w.isPrivate, false);
  assert.equal(w.createdAt, undefined);
});

test("buildNativeAgentMessageWhere applies createdAt gt when lastClearedAt set", () => {
  const t = new Date("2026-05-11T12:00:00.000Z");
  const w = buildNativeAgentMessageWhere({
    conversationId: "c1",
    excludeMessageId: "m0",
    lastClearedAt: t,
  });
  assert.deepEqual(w.createdAt, { gt: t });
  assert.equal(w.isPrivate, false);
});

test("buildNativeAgentTranscriptWhere excludes private messages and applies clear cutoff", () => {
  const t = new Date("2026-05-11T12:00:00.000Z");
  const w = buildNativeAgentTranscriptWhere({ conversationId: "c1", lastClearedAt: t });
  assert.equal(w.conversationId, "c1");
  assert.equal(w.isPrivate, false);
  assert.deepEqual(w.createdAt, { gt: t });
});

test("buildNativeAgentInboundMediaWhere filters inbound media after clear", () => {
  const t = new Date("2026-05-11T12:00:00.000Z");
  const w = buildNativeAgentInboundMediaWhere({ conversationId: "c1", lastClearedAt: t });
  assert.equal(w.direction, "INBOUND");
  assert.deepEqual(w.createdAt, { gt: t });
});

test("shouldIsolateHistoryForConnectedTools is opt-in only", () => {
  assert.equal(
    shouldIsolateHistoryForConnectedTools({ connectedAutoHttpToolCount: 2 }),
    false,
  );
  assert.equal(
    shouldIsolateHistoryForConnectedTools({
      connectedAutoHttpToolCount: 2,
      isolateHistoryEnabled: false,
    }),
    false,
  );
  assert.equal(
    shouldIsolateHistoryForConnectedTools({
      connectedAutoHttpToolCount: 0,
      isolateHistoryEnabled: true,
    }),
    false,
  );
  assert.equal(
    shouldIsolateHistoryForConnectedTools({
      connectedAutoHttpToolCount: 2,
      isolateHistoryEnabled: true,
    }),
    true,
  );
});

test("resolveNativeAgentHistoryTurns clears history when tools isolate", () => {
  const loaded = [
    { role: "user" as const, content: "Check-in do João" },
    { role: "assistant" as const, content: "Reserva ABC confirmada para João." },
  ];
  const isolated = resolveNativeAgentHistoryTurns({
    loadedHistory: loaded,
    isolateForConnectedTools: true,
  });
  assert.equal(isolated.isolated, true);
  assert.deepEqual(isolated.history, []);

  const kept = resolveNativeAgentHistoryTurns({
    loadedHistory: loaded,
    isolateForConnectedTools: false,
  });
  assert.equal(kept.isolated, false);
  assert.equal(kept.history.length, 2);

  const override = resolveNativeAgentHistoryTurns({
    loadedHistory: loaded,
    historyOverride: [{ role: "user", content: "teste" }],
    isolateForConnectedTools: true,
  });
  assert.equal(override.isolated, false);
  assert.equal(override.history[0]?.content, "teste");
});

test("flowSlotsConflictWithUserIdentity detects new localizer vs previous guest", () => {
  assert.equal(
    flowSlotsConflictWithUserIdentity(
      { reservationIdOrLocalizer: "A3FIULCZ", guestName: "João" },
      "B9NEWID01",
    ),
    true,
  );
  assert.equal(
    flowSlotsConflictWithUserIdentity(
      { reservationIdOrLocalizer: "A3FIULCZ", guestName: "João" },
      "A3FIULCZ",
    ),
    false,
  );
  assert.equal(
    flowSlotsConflictWithUserIdentity(
      { reservationIdOrLocalizer: "A3FIULCZ" },
      "[Imagem enviada pelo cliente]",
    ),
    false,
  );
  assert.ok(extractIdentityTokensFromUserMessage("699.606.761-88").includes("69960676188"));
});
