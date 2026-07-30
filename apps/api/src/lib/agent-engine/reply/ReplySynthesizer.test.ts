import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureDeliveringReply,
  buildModeloS1FromReservationPayload,
  replyLooksLikeModeloS1,
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

test("buildModeloS1FromReservationPayload matches prompt Modelo S1", () => {
  const s1 = buildModeloS1FromReservationPayload(RESERVATION_PAYLOAD, {
    userMessage: "fazer check-in na reserva NCMT0VPN",
  });
  assert.match(s1, /^Olá! 😊\nEncontramos sua reserva com sucesso!/);
  assert.match(s1, /Vivá Porto de Galinhas/);
  assert.match(s1, /01\/08\/2026/);
  assert.match(s1, /03\/08\/2026/);
  assert.match(s1, /👥 Hóspedes: 2/);
  assert.match(s1, /checkin\/vivapp\/access/);
  assert.match(s1, /brasileiro|estrangeiro/i);
  assert.doesNotMatch(s1, /Invocando/i);
  assert.equal(replyLooksLikeModeloS1(s1), true);
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
  assert.match(result.reply, /Encontramos sua reserva/);
  assert.match(result.reply, /Vivá Porto de Galinhas/);
  assert.doesNotMatch(result.reply, /Invocando/i);
  assert.doesNotMatch(result.reply, /Consultando a reserva/i);
});

test("ensureDeliveringReply forces S1 when LLM invents non-script check-in reply", () => {
  const invented =
    "Pronto! Localizei a reserva NCMT0VPN em Vivá. Pode me dizer seu CPF para seguirmos?";
  const result = ensureDeliveringReply({
    replyText: invented,
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
  assert.match(result.reply, /^Olá! 😊/);
  assert.match(result.reply, /Encontramos sua reserva com sucesso!/);
  assert.match(result.reply, /brasileiro\(a\) ou estrangeiro/);
  assert.doesNotMatch(result.reply, /CPF/);
});

test("ensureDeliveringReply keeps reply that already looks like Modelo S1", () => {
  const good =
    "Olá! 😊\nEncontramos sua reserva com sucesso!\n📍 Hospedagem: Hotel X\n📅 Check-in: 01/08/2026, a partir das 14:00h\n📅 Check-out: 03/08/2026, até as 12:00h\n👥 Hóspedes: 1\nSeu check-in ainda não foi realizado.\n✅ Pelo link: 🔗 https://pms.audaar.com.br/checkin/vivapp/access\n💬 Por este chat: responda abaixo.\nPara começar, informe: você é brasileiro(a) ou estrangeiro(a)?";
  const result = ensureDeliveringReply({
    replyText: good,
    userMessage: "fazer check-in na reserva NCMT0VPN",
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

test("ensureDeliveringReply forces S9 template after embratur-reference", () => {
  const result = ensureDeliveringReply({
    replyText: "",
    userMessage: "Sim",
    toolOutcomes: [
      {
        name: "embratur-reference",
        ok: true,
        preview: '{"ids":[1,2,3]}',
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "embratur_s9");
  assert.match(result.reply, /motivo da viagem/i);
  assert.match(result.reply, /meio de transporte/i);
});

test("ensureDeliveringReply forces S10 ack after audaar_check_in", () => {
  const result = ensureDeliveringReply({
    replyText: "",
    userMessage: "sim",
    toolOutcomes: [
      {
        name: "audaar_check_in",
        ok: true,
        preview: '{"ok":true}',
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "check_in_ack");
  assert.match(result.reply, /check-in foi concluído/i);
});
