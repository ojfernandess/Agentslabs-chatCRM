import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assistantAskedForConfirmation,
  formatScalarFactLabel,
  isInternalScalarLeaf,
  resolveStrictModeRescueReply,
  shouldOfferGroundedConfirmationRescue,
} from "./StrictModeRescue.js";

test("formatScalarFactLabel humanizes JSON paths", () => {
  assert.equal(formatScalarFactLabel("data.guest.documentNumber"), "Document Number");
  assert.equal(formatScalarFactLabel("guestName"), "Guest Name");
});

test("isInternalScalarLeaf skips technical ids", () => {
  assert.equal(isInternalScalarLeaf("reservationId"), true);
  assert.equal(isInternalScalarLeaf("uid"), true);
  assert.equal(isInternalScalarLeaf("documentNumber"), false);
  assert.equal(isInternalScalarLeaf("name"), false);
});

test("shouldOfferGroundedConfirmationRescue false on initial lookup turn", () => {
  assert.equal(
    shouldOfferGroundedConfirmationRescue("fazer check-in na reserva ABC123", ""),
    false,
  );
  assert.equal(shouldOfferGroundedConfirmationRescue("sim", "Confirme os dados do titular."), true);
});

test("assistantAskedForConfirmation detects mirror prompts", () => {
  assert.equal(
    assistantAskedForConfirmation("Encontrei estes dados. Está tudo correto?"),
    true,
  );
  assert.equal(assistantAskedForConfirmation("Qual a sua nacionalidade?"), false);
});

test("resolveStrictModeRescueReply preserves supervisor-approved reply on structural block", () => {
  const modelReply =
    "Reserva encontrada para Odair. Check-in 31/07. Qual a sua nacionalidade?";
  const result = resolveStrictModeRescueReply({
    originalReply: modelReply,
    userMessage: "fazer check-in na reserva HVW4V2D5",
    lastAssistantMessage: "",
    llmSupervisorApproved: true,
    toolOutcomes: [
      {
        name: "lookup_reservation",
        ok: true,
        preview: JSON.stringify({
          data: { guest: { name: "Odair", documentNumber: "41026299802" } },
        }),
      },
    ],
    hasSubstantiveReply: (t) => t.length > 20,
    buildCompletionSuccessAck: () => null,
    buildGroundedConfirmation: () => "Encontrei estes dados\n\n- data.guest.name: Odair\n\nConfirma?",
    buildDeterministicReply: () => "Segue o resultado da consulta.",
  });
  assert.equal(result.kind, "supervisor_preserve");
  assert.equal(result.reply, modelReply);
});

test("resolveStrictModeRescueReply uses humanized summary not grounded on lookup turn", () => {
  const result = resolveStrictModeRescueReply({
    originalReply: "stall text only",
    userMessage: "consultar pedido #12345",
    lastAssistantMessage: "",
    llmSupervisorApproved: false,
    toolOutcomes: [{ name: "get_order", ok: true, preview: '{"status":"shipped","orderId":"12345"}' }],
    hasSubstantiveReply: () => false,
    buildCompletionSuccessAck: () => null,
    buildGroundedConfirmation: () => "Encontrei estes dados\n\nConfirma?",
    buildDeterministicReply: () => "Segue o resultado da consulta:\n\nPedido enviado.",
  });
  assert.equal(result.kind, "humanized_tool_summary");
  assert.match(result.reply!, /Segue o resultado/);
  assert.doesNotMatch(result.reply!, /Confirma\?/);
});

test("resolveStrictModeRescueReply allows grounded confirmation on sim turn", () => {
  const result = resolveStrictModeRescueReply({
    originalReply: "",
    userMessage: "sim",
    lastAssistantMessage: "Os dados estão corretos?",
    llmSupervisorApproved: false,
    toolOutcomes: [
      { name: "lookup_guest", ok: true, preview: "{}", structuredPayload: { name: "Ana" } },
    ],
    hasSubstantiveReply: () => false,
    buildCompletionSuccessAck: () => null,
    buildGroundedConfirmation: () => "Confirme: Ana. Confirma?",
    buildDeterministicReply: () => "fallback",
  });
  assert.equal(result.kind, "grounded_confirmation");
  assert.match(result.reply!, /Confirme: Ana/);
});
