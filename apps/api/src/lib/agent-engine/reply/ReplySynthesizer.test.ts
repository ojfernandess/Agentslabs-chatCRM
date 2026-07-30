import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureDeliveringReply,
  buildModeloS1FromReservationPayload,
  buildModeloS4cCompanionOptIn,
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

test("ensureDeliveringReply forces S1 when paraphrase misses prompt script", () => {
  const paraphrase =
    "Olá! Encontrei sua reserva.\n📍 Hospedagem: Vivá\n📅 Check-in: 01/08/2026\n📅 Check-out: 03/08/2026\n👥 Hóspedes: 2\nPode me dizer se é brasileiro?";
  const result = ensureDeliveringReply({
    replyText: paraphrase,
    userMessage: "fazer check-in na reserva NCMT0VPN",
    toolOutcomes: [
      {
        name: "audaar_consultar_reserva",
        ok: true,
        preview: "Resultado da ferramenta",
        structuredPayload: {
          data: {
            stay: {
              checkinDate: "2026-08-01",
              checkoutDate: "2026-08-03",
              guestsQuantity: 2,
              localizer: "NCMT0VPN",
            },
            establishment: { name: "Vivá Porto de Galinhas" },
          },
        },
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "reservation_s1");
  assert.match(result.reply, /Encontramos sua reserva com sucesso!/);
  assert.match(result.reply, /checkin\/vivapp\/access/);
  assert.match(result.reply, /brasileiro\(a\) ou estrangeiro/);
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
        preview: JSON.stringify({
          motivosViagem: [{ id: 1, nome: "Lazer/Férias" }],
          meiosTransporte: [{ id: 2, nome: "Automóvel" }],
          paises: [{ id: "1058", nome: "Brasil" }],
          cidades: [{ id: 3550308, nome: "São Paulo" }],
        }),
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "embratur_s9");
  assert.match(result.reply, /motivo da viagem/i);
  assert.match(result.reply, /Lazer\/Férias/);
  assert.match(result.reply, /Automóvel/);
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

test("buildModeloS4cCompanionOptIn uses N and N-1", () => {
  const s4c = buildModeloS4cCompanionOptIn(2);
  assert.match(s4c, /2 hóspedes/);
  assert.match(s4c, /\+ 1 acompanhante/);
  assert.match(s4c, /Deseja cadastrar/);
  assert.doesNotMatch(s4c, /\+ 0 acompanhante/);
});

test("ensureDeliveringReply replaces truncated check-in JSON stall (16:09 bug)", () => {
  const rawJson =
    '{"message":"Check-in realizado com sucesso","data":{"checkin":{"reservationId":279321,"mode":"digital","checkin":0,"checkin_mobile":1,"checkinApi":1,"validatedCheckin":1,"hasCheckinApproved":1,"sentToReception":1,"checkinActionDate":null,"localizedDate":"2026-07-30T19:09:48.000Z"';
  const result = ensureDeliveringReply({
    replyText: "Um momento",
    userMessage: "sim",
    toolOutcomes: [
      {
        name: "audaar_check_in",
        ok: true,
        preview: rawJson.slice(0, 500),
      },
    ],
  });
  assert.equal(result.reason, "check_in_ack");
  assert.match(result.reply, /check-in foi concluído/i);
  assert.doesNotMatch(result.reply, /reservationId|validatedCheckin/);
});

test("ensureDeliveringReply replaces echoed check-in JSON even without ok tool name match", () => {
  const rawJson =
    '{"message":"Check-in realizado com sucesso","data":{"checkin":{"reservationId":279321,"validatedCheckin":1}}}';
  const result = ensureDeliveringReply({
    replyText: rawJson,
    userMessage: "sim",
    toolOutcomes: [{ name: "oc_tool_abc", ok: true, preview: rawJson }],
  });
  assert.equal(result.reason, "check_in_ack");
  assert.match(result.reply, /check-in foi concluído/i);
});

test("ensureDeliveringReply does not force Modelo S1 on post-completion follow-up", () => {
  const result = ensureDeliveringReply({
    replyText: "Wi-Fi: rede X senha Y",
    userMessage: "envie os detalhes da estadia",
    toolOutcomes: [
      {
        name: "audaar_consultar_reserva",
        ok: true,
        preview: JSON.stringify(RESERVATION_PAYLOAD),
        structuredPayload: RESERVATION_PAYLOAD,
      },
    ],
  });
  assert.equal(result.replaced, false);
  assert.match(result.reply, /Wi-Fi/);
  assert.doesNotMatch(result.reply, /brasileiro\(a\) ou estrangeiro/);
});
