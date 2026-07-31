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
  assert.match(s1, /realize seu cadastro|1️⃣/i);
  assert.match(s1, /informe o localizador|NCMT0VPN/i);
  assert.doesNotMatch(s1, /brasileiro|estrangeiro/i);
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
  assert.match(result.reply, /realize seu cadastro|1️⃣/i);
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
  assert.match(result.reply, /informe o localizador|realize seu cadastro/i);
});

test("ensureDeliveringReply keeps reply that already looks like Modelo S1", () => {
  const good =
    "Olá! 😊\nEncontramos sua reserva com sucesso!\n📍 Hospedagem: Hotel X\n📅 Check-in: 01/08/2026, a partir das 14:00h\n📅 Check-out: 03/08/2026, até as 12:00h\n👥 Hóspedes: 1\nSeu check-in ainda não foi realizado.\n\nPara concluir, acesse o link abaixo e siga estes passos:\n\n🔗 https://pms.audaar.com.br/checkin/vivapp/access\n\n1️⃣ Acesse o link e **realize seu cadastro** (primeira vez).\n2️⃣ **Entre novamente** no mesmo link e **informe o localizador** da reserva (ABC123) para fazer o check-in.\n3️⃣ Após preencher todas as informações necessárias, o sistema mostrará o **número da sua suíte** e a **senha** ou **forma de acesso**.\n\nSe tiver dúvidas durante o processo, estou por aqui! 😊";
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

test("ensureDeliveringReply replaces quote availability stall after failed tool", () => {
  const result = ensureDeliveringReply({
    replyText:
      "Vou consultar a disponibilidade agora. Um momento, por favor.\n\n*audaar_consultar_disponibilidade*",
    userMessage: "sim",
    toolOutcomes: [
      {
        name: "audaar_consultar_disponibilidade",
        ok: false,
        preview: '{"ok":false,"error":"schema_validation_failed"}',
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.match(result.reply, /Não consegui consultar a disponibilidade/i);
});

test("ensureDeliveringReply replaces main_guest stall with deterministic fallback (09:47 bug)", () => {
  const mainGuestPayload = {
    found: true,
    guestName: "João Silva",
    reservationCode: "EGAI6QKW",
  };
  const result = ensureDeliveringReply({
    replyText: "Um momento, por favor.",
    userMessage: "41026299802",
    toolOutcomes: [
      {
        name: "audaar_consultar_main_guest",
        ok: true,
        preview: JSON.stringify(mainGuestPayload),
        structuredPayload: mainGuestPayload,
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "deterministic_fallback");
  assert.match(result.reply, /João Silva/);
  assert.match(result.reply, /Segue o resultado da consulta/);
  assert.doesNotMatch(result.reply, /^um momento/i);
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
