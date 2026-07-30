import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureDeliveringReply,
  buildModeloS1FromReservationPayload,
} from "./ReplySynthesizer.js";

const REPLY_1131 =
  "Vou consultar… Um momento…\n\n### Consultando a reserva…\n\n(Invocando a ferramenta `audaar_consultar_reserva`).";

const RESERVATION_PAYLOAD = {
  found: true,
  uid: "NCMT0VPN",
  establishmentName: "Vivá Porto de Galinhas",
  checkinDate: "2026-08-01",
  checkoutDate: "2026-08-03",
  guestsQuantity: 2,
};

test("buildModeloS1FromReservationPayload includes lodging dates and guests", () => {
  const s1 = buildModeloS1FromReservationPayload(RESERVATION_PAYLOAD, {
    userMessage: "fazer check-in na reserva NCMT0VPN",
  });
  assert.match(s1, /Vivá Porto de Galinhas/);
  assert.match(s1, /01\/08\/2026/);
  assert.match(s1, /03\/08\/2026/);
  assert.match(s1, /2/);
  assert.match(s1, /brasileiro|estrangeiro/i);
  assert.doesNotMatch(s1, /Invocando/i);
});

test("ensureDeliveringReply replaces 11:31 stall with Modelo S1", () => {
  const result = ensureDeliveringReply({
    replyText: REPLY_1131,
    userMessage: "fazer check-in na reserva NCMT0VPN",
    toolOutcomes: [
      {
        name: "audaar_consultar_reserva",
        ok: true,
        preview: JSON.stringify(RESERVATION_PAYLOAD),
        structuredPayload: RESERVATION_PAYLOAD,
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "reservation_s1");
  assert.match(result.reply, /Hospedagem/);
  assert.match(result.reply, /Vivá Porto de Galinhas/);
  assert.doesNotMatch(result.reply, /Invocando/i);
  assert.doesNotMatch(result.reply, /Consultando a reserva/i);
});

test("ensureDeliveringReply keeps substantive reply", () => {
  const good =
    "Encontrei sua reserva com sucesso!\n📍 Hospedagem: Hotel X\n📅 Check-in: 01/08/2026\n👥 Hóspedes: 1\nPara começar, informe: você é brasileiro(a) ou estrangeiro(a)?";
  const result = ensureDeliveringReply({
    replyText: good,
    toolOutcomes: [
      {
        name: "audaar_consultar_reserva",
        ok: true,
        preview: "{}",
        structuredPayload: RESERVATION_PAYLOAD,
      },
    ],
  });
  assert.equal(result.replaced, false);
  assert.equal(result.reply, good);
});

test("ensureDeliveringReply no-op without successful tools", () => {
  const result = ensureDeliveringReply({
    replyText: REPLY_1131,
    toolOutcomes: [],
  });
  assert.equal(result.replaced, false);
  assert.equal(result.reply, REPLY_1131);
});
