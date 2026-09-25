import assert from "node:assert/strict";
import test from "node:test";
import { pickEscalationTransferFallbackBody } from "./escalationTransferFallback.js";

test("pickEscalationTransferFallbackBody returns model reply when different", () => {
  assert.equal(
    pickEscalationTransferFallbackBody(
      "Transferindo para atendimento humano.",
      "Vou encaminhar sua pergunta para um atendente.",
    ),
    "Vou encaminhar sua pergunta para um atendente.",
  );
});

test("pickEscalationTransferFallbackBody null when same or empty", () => {
  assert.equal(pickEscalationTransferFallbackBody("mesma", "mesma"), null);
  assert.equal(pickEscalationTransferFallbackBody("primary", ""), null);
});
