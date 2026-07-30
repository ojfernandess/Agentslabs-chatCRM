import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isToolNarrationReply,
  isNonDeliveringAgentReply,
  isLikelyStallOnlyReply,
  hasSubstantiveAgentReplyToCustomer,
} from "./ReplyQuality.js";

/** Texto exacto da execução 11:31 (`c28f4e93`). */
const REPLY_1131 =
  "Vou consultar… Um momento…\n\n### Consultando a reserva…\n\n(Invocando a ferramenta `audaar_consultar_reserva`).";

test("isToolNarrationReply catches 11:31 Invocando ferramenta format", () => {
  assert.equal(isToolNarrationReply(REPLY_1131), true);
  assert.equal(isNonDeliveringAgentReply(REPLY_1131), true);
  assert.equal(isLikelyStallOnlyReply(REPLY_1131), true);
  assert.equal(hasSubstantiveAgentReplyToCustomer(REPLY_1131), false);
});

test("isToolNarrationReply does not flag Modelo S1 with facts", () => {
  const s1 =
    "Encontrei sua reserva com sucesso!\n\n" +
    "📍 Hospedagem: Hotel Teste\n" +
    "📅 Check-in: 01/08/2026, a partir das 14:00h\n" +
    "📅 Check-out: 03/08/2026, até as 12:00h\n" +
    "👥 Hóspedes: 2\n" +
    "Seu check-in ainda não foi realizado.\n\n" +
    "Para começar, informe: você é brasileiro(a) ou estrangeiro(a)?";
  assert.equal(isToolNarrationReply(s1), false);
  assert.equal(isNonDeliveringAgentReply(s1), false);
  assert.equal(hasSubstantiveAgentReplyToCustomer(s1), true);
});

test("isLikelyStallOnlyReply still catches short stalls", () => {
  assert.equal(isLikelyStallOnlyReply("Só um momento por gentileza"), true);
  assert.equal(isLikelyStallOnlyReply("O endereço é Rua Acruás, 267."), false);
});
