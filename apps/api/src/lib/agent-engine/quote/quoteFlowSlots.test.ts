import assert from "node:assert/strict";
import test from "node:test";
import {
  extractQuoteFlowSlotsFromText,
  mergeQuoteFlowSlotsFromConversation,
} from "./quoteFlowSlots.js";

test("extractQuoteFlowSlotsFromText — Modelo C6 Confirm", () => {
  const text = `Perfeito! Então temos:
🏢 Propriedade: Audaar Tech Suites
📅 Data de chegada: 02/08/2026
📅 Data de partida: 03/08/2026
👤 Quantidade de pessoas: 2
Está tudo certo? Posso consultar a disponibilidade?`;
  const slots = extractQuoteFlowSlotsFromText(text);
  assert.equal(slots.establishmentId, 49);
  assert.equal(slots.checkinDate, "2026-08-02");
  assert.equal(slots.checkoutDate, "2026-08-03");
  assert.equal(slots.guestsQuantity, 2);
});

test("extractQuoteFlowSlotsFromText — stay details message", () => {
  const text = `Data de chegada (check-in): 02/08/2026
Data de partida (checkout): 03/08/2026
2 pessoas`;
  const slots = extractQuoteFlowSlotsFromText(text);
  assert.equal(slots.checkinDate, "2026-08-02");
  assert.equal(slots.checkoutDate, "2026-08-03");
  assert.equal(slots.guestsQuantity, 2);
});

test("mergeQuoteFlowSlotsFromConversation accumulates from assistant + user history", () => {
  const merged = mergeQuoteFlowSlotsFromConversation({
    flowSlots: {},
    userMessage: "sim",
    lastAssistantMessage: "🏢 Propriedade: Audaar Tech Suites\n📅 Data de chegada: 02/08/2026",
    historyUserMessages: [
      "gostaria de fazer uma cotação para audaar tech",
      "Data de partida (checkout): 03/08/2026\n2 pessoas",
    ],
  });
  assert.equal(merged.establishmentId, 49);
  assert.equal(merged.checkinDate, "2026-08-02");
  assert.equal(merged.checkoutDate, "2026-08-03");
  assert.equal(merged.guestsQuantity, 2);
});
