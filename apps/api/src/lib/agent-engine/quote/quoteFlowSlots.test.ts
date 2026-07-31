import assert from "node:assert/strict";
import test from "node:test";
import {
  extractQuoteFlowSlotsFromText,
  mergeQuoteFlowSlotsFromConversation,
  resetQuoteAvailabilitySessionState,
} from "./quoteFlowSlots.js";
import { QUOTE_OPTIONS_CATALOG_SLOT } from "./quoteAvailabilityReply.js";
import { SESSION_SATISFIED_TOOLS_KEY } from "../core/sessionToolOutcomes.js";

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

test("resetQuoteAvailabilitySessionState clears prior availability and call_human satisfaction", () => {
  const reset = resetQuoteAvailabilitySessionState({
    [SESSION_SATISFIED_TOOLS_KEY]: "audaar_consultar_disponibilidade,call_human",
    [QUOTE_OPTIONS_CATALOG_SLOT]: '{"options":[]}',
  });
  assert.equal(reset[SESSION_SATISFIED_TOOLS_KEY], undefined);
  assert.equal(reset[QUOTE_OPTIONS_CATALOG_SLOT], undefined);
});

test("mergeQuoteFlowSlotsFromConversation resets availability on new quote request", () => {
  const merged = mergeQuoteFlowSlotsFromConversation({
    flowSlots: {
      [SESSION_SATISFIED_TOOLS_KEY]: "audaar_consultar_disponibilidade",
      [QUOTE_OPTIONS_CATALOG_SLOT]: '{"options":[]}',
    },
    userMessage: "gostaria de fazer uma cotação",
    lastAssistantMessage: "",
  });
  assert.equal(merged[SESSION_SATISFIED_TOOLS_KEY], undefined);
  assert.equal(merged[QUOTE_OPTIONS_CATALOG_SLOT], undefined);
});

const C6_CONFIRM = `Perfeito! Então temos:
🏢 Propriedade: Vivapp Club Suítes
📅 Data de chegada: 02/08/2026
📅 Data de partida: 04/08/2026
👤 Quantidade de pessoas: 2
Está tudo certo? Posso consultar a disponibilidade?`;

test("mergeQuoteFlowSlotsFromConversation strips prior availability before C6c sim", () => {
  const merged = mergeQuoteFlowSlotsFromConversation({
    flowSlots: {
      [SESSION_SATISFIED_TOOLS_KEY]: "audaar_consultar_disponibilidade",
      establishmentId: 3,
      checkinDate: "2026-08-02",
      checkoutDate: "2026-08-04",
      guestsQuantity: 2,
    },
    userMessage: "sim",
    lastAssistantMessage: C6_CONFIRM,
  });
  assert.equal(merged[SESSION_SATISFIED_TOOLS_KEY], undefined);
});

const C6_OPTIONS_MSG = `Consultei a disponibilidade para o período informado - 03/08/2026 a 04/08/2026. Estas são as opções:

1️⃣ Standard Quadruplo (4 camas) — R$ 210,00 / diária · R$ 210,00 total
2️⃣ Deluxe Duplo — R$ 380,00 / diária · R$ 380,00 total

Qual opção você prefere?`;

test("mergeQuoteFlowSlotsFromConversation strips prior call_human on quote option choice", () => {
  const merged = mergeQuoteFlowSlotsFromConversation({
    flowSlots: { [SESSION_SATISFIED_TOOLS_KEY]: "call_human" },
    userMessage: "Standard Quadruplo (4 camas)",
    lastAssistantMessage: C6_OPTIONS_MSG,
  });
  assert.equal(merged[SESSION_SATISFIED_TOOLS_KEY], undefined);
});
