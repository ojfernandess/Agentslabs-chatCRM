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

const AVAILABILITY_PAYLOAD = {
  data: {
    establishmentId: 49,
    checkin: "2026-08-03",
    checkout: "2026-08-04",
    guests: 2,
    nights: 1,
    categories: [
      {
        categoryName: "Suíte Executiva",
        available: true,
        ratePlans: [
          { channelName: "Balcão", totalPrice: 210, averageNightlyPrice: 210, available: true },
          {
            channelName: "Motor de reserva",
            totalPrice: 257,
            averageNightlyPrice: 257,
            available: true,
          },
          { channelName: "REEMBOLSAVEL", totalPrice: 346, averageNightlyPrice: 346, available: true },
        ],
      },
      {
        categoryName: "Suíte Deluxe",
        available: true,
        ratePlans: [
          { channelName: "Balcão", totalPrice: 380, averageNightlyPrice: 380, available: true },
          {
            channelName: "Motor de reserva",
            totalPrice: 704,
            averageNightlyPrice: 704,
            available: true,
          },
        ],
      },
    ],
  },
};

test("ensureDeliveringReply renders Modelo C6 Opções with Balcão, period, diária and total", () => {
  const result = ensureDeliveringReply({
    replyText: "Consultei! Suíte Executiva por R$ 257.",
    userMessage: "sim",
    toolOutcomes: [
      {
        name: "audaar_consultar_disponibilidade",
        ok: true,
        preview: JSON.stringify(AVAILABILITY_PAYLOAD),
        structuredPayload: AVAILABILITY_PAYLOAD,
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_c6_options");
  assert.match(result.reply, /03\/08\/2026 a 04\/08\/2026/);
  assert.match(result.reply, /R\$ 210,00 \/ diária · R\$ 210,00 total/);
  assert.match(result.reply, /R\$ 380,00 \/ diária · R\$ 380,00 total/);
  assert.doesNotMatch(result.reply, /Motor de reserva|REEMBOLSAVEL|Balcão/i);
});

const C6_CONFIRM_MSG = `Perfeito! Então temos:
🏢 Propriedade: Vivapp Club Suítes
📅 Data de chegada: 02/08/2026
📅 Data de partida: 04/08/2026
👤 Quantidade de pessoas: 2
Está tudo certo? Posso consultar a disponibilidade?`;

test("ensureDeliveringReply blocks invented quote after C6 Confirm without availability tool", () => {
  const invented = `Consultei a disponibilidade para o período informado - 02/08/2026 a 04/08/2026. Estas são as opções:

1️⃣ Standard — R$ 450,00 / diária · R$ 900,00 total
2️⃣ Deluxe — R$ 650,00 / diária · R$ 1.300,00 total

Qual opção você prefere?`;
  const result = ensureDeliveringReply({
    replyText: invented,
    userMessage: "sim",
    lastAssistantMessage: C6_CONFIRM_MSG,
    toolOutcomes: [],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_availability_failed");
  assert.match(result.reply, /Preciso consultar a disponibilidade no sistema/i);
  assert.doesNotMatch(result.reply, /R\$ 450|Standard|Deluxe/i);
});

const C6_OPTIONS_MSG = `Consultei a disponibilidade para o período informado - 03/08/2026 a 04/08/2026. Estas são as opções:

1️⃣ Suíte Executiva — R$ 210,00 / diária · R$ 210,00 total
2️⃣ Suíte Deluxe — R$ 380,00 / diária · R$ 380,00 total

Qual opção você prefere?`;

test("ensureDeliveringReply offers discount transfer when guest says it is expensive", () => {
  const result = ensureDeliveringReply({
    replyText: "Claro, posso aplicar 10% de desconto para você!",
    userMessage: "está muito caro, tem desconto?",
    lastAssistantMessage: C6_OPTIONS_MSG,
    toolOutcomes: [],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_c6_discount_offer");
  assert.match(result.reply, /Não posso conceder descontos/i);
  assert.doesNotMatch(result.reply, /10%|aplicar desconto|claro/i);
});

const C6_DISCOUNT_OFFER_MSG = `Entendo sua preocupação com o valor. Não posso conceder descontos por aqui, mas posso transferir você para nossa equipe de atendimento para verificar se há alguma condição especial disponível.

Deseja que eu faça essa transferência?`;

test("ensureDeliveringReply renders discount handoff after sim and call_human OK", () => {
  const result = ensureDeliveringReply({
    replyText: "Perfeito! Vou transferir agora. Um momento.\n\n*call_human*",
    userMessage: "sim",
    lastAssistantMessage: C6_DISCOUNT_OFFER_MSG,
    toolOutcomes: [{ name: "call_human", ok: true, preview: '{"ok":true}' }],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_c6_discount_handoff");
  assert.match(result.reply, /transferir.*equipe de atendimento/i);
  assert.match(result.reply, /desconto|condi[cç][aã]o especial/i);
  assert.doesNotMatch(result.reply, /\*call_human\*|um momento/i);
});

test("ensureDeliveringReply forces C6 options when LLM mimics format with Motor prices", () => {
  const wrongLlmReply = `Consultei a disponibilidade para o período informado - 03/08/2026 a 04/08/2026. Estas são as opções:

1️⃣ Suíte Executiva — R$ 257,00 / diária · R$ 257,00 total
2️⃣ Suíte Deluxe — R$ 704,00 / diária · R$ 704,00 total

Qual opção você prefere?`;
  const result = ensureDeliveringReply({
    replyText: wrongLlmReply,
    userMessage: "sim",
    toolOutcomes: [
      {
        name: "audaar_consultar_disponibilidade",
        ok: true,
        preview: JSON.stringify(AVAILABILITY_PAYLOAD),
        structuredPayload: AVAILABILITY_PAYLOAD,
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_c6_options");
  assert.match(result.reply, /R\$ 380,00 \/ diária · R\$ 380,00 total/);
  assert.doesNotMatch(result.reply, /704/);
});

test("ensureDeliveringReply replaces call_human stall with Modelo C6 handoff summary", () => {
  const catalog = JSON.stringify({
    establishmentName: "Vivá Porto de Galinhas",
    checkin: "03/08/2026",
    checkout: "04/08/2026",
    guests: 2,
    options: [
      { categoryName: "Suíte Executiva", nightlyPrice: 210, totalPrice: 210 },
      { categoryName: "Suíte Deluxe", nightlyPrice: 380, totalPrice: 380 },
    ],
  });
  const result = ensureDeliveringReply({
    replyText:
      "Perfeito! Vou encaminhar sua preferência para nossa equipe. Um momento, por favor.\n\n*call_human*",
    userMessage: "1",
    lastAssistantMessage: C6_OPTIONS_MSG,
    flowSlots: { __quoteOptionsCatalog: catalog },
    toolOutcomes: [{ name: "call_human", ok: true, preview: '{"ok":true}' }],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_c6_handoff");
  assert.match(result.reply, /Perfeito! Então temos/i);
  assert.match(result.reply, /Vivá Porto de Galinhas/);
  assert.match(result.reply, /Suíte Executiva/i);
  assert.match(result.reply, /R\$ 210,00 total/);
  assert.match(result.reply, /encaminhar seu atendimento para nossa equipe/i);
  assert.doesNotMatch(result.reply, /\*call_human\*|um momento/i);
});

test("ensureDeliveringReply appends quote options after category KB answer", () => {
  const result = ensureDeliveringReply({
    replyText: "O Standard Quadruplo possui 4 camas de solteiro.",
    userMessage: "Quantas camas tem o Standard Quadruplo?",
    lastAssistantMessage: C6_OPTIONS_MSG,
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: '{"found":true}' }],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_c6_category_info_return");
  assert.match(result.reply, /4 camas de solteiro/i);
  assert.match(result.reply, /Qual opção você prefere/i);
  assert.match(result.reply, /R\$ 210,00 total/);
});

test("ensureDeliveringReply blocks fake transfer when call_human did not run on quote choice", () => {
  const result = ensureDeliveringReply({
    replyText: "Perfeito! Vou encaminhar você para nossa equipe de atendimento.",
    userMessage: "Standard Quadruplo (4 camas)",
    lastAssistantMessage: `Consultei a disponibilidade para o período informado - 03/08/2026 a 04/08/2026. Estas são as opções:

1️⃣ Standard Quadruplo (4 camas) — R$ 210,00 / diária · R$ 210,00 total

Qual opção você prefere?`,
    toolOutcomes: [],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "quote_call_human_missing");
  assert.match(result.reply, /problema ao encaminhar/i);
  assert.doesNotMatch(result.reply, /Perfeito! Então temos/i);
});

test("ensureDeliveringReply blocks fake C13 transfer when call_human did not run", () => {
  const result = ensureDeliveringReply({
    replyText: "Entendi. Vou transferir você para a equipe de atendimento dar continuidade.",
    userMessage: "falar com atendimento",
    toolOutcomes: [],
  });
  assert.equal(result.replaced, true);
  assert.equal(result.reason, "escalation_call_human_missing");
  assert.match(result.reply, /problema ao transferir/i);
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
