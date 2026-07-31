import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModeloC6DiscountTransferOfferReply,
  buildModeloC6HandoffReply,
  buildModeloC6OptionsReply,
  buildQuoteOptionsCatalogFromPayload,
  formatQuoteStayPeriod,
  isBalconRatePlan,
  messageLooksLikeQuoteDiscountObjection,
  replyLooksLikeModeloC6Options,
  replyShouldPreemptEscalationTransferMessage,
  resolveQuoteHandoffContext,
  selectBalconRatePlan,
} from "./quoteAvailabilityReply.js";

const SAMPLE_PAYLOAD = {
  data: {
    establishmentId: 49,
    checkin: "2026-08-03",
    checkout: "2026-08-04",
    guests: 2,
    nights: 1,
    categories: [
      {
        categoryId: 182,
        categoryName: "Suíte Executiva",
        available: true,
        ratePlans: [
          {
            channelName: "Balcão",
            ratePlanName: "Balcão",
            totalPrice: 210,
            averageNightlyPrice: 210,
            available: true,
          },
          {
            channelName: "Motor de reserva",
            ratePlanName: "Motor de reserva",
            totalPrice: 257,
            averageNightlyPrice: 257,
            available: true,
          },
          {
            channelName: "REEMBOLSAVEL",
            ratePlanName: "REEMBOLSAVEL",
            totalPrice: 346,
            averageNightlyPrice: 346,
            available: true,
          },
        ],
      },
      {
        categoryId: 179,
        categoryName: "Suíte Deluxe",
        available: true,
        ratePlans: [
          {
            channelName: "Balcão",
            ratePlanName: "Balcão",
            totalPrice: 380,
            averageNightlyPrice: 380,
            available: true,
          },
          {
            channelName: "Motor de reserva",
            ratePlanName: "Motor de reserva",
            totalPrice: 704,
            averageNightlyPrice: 704,
            available: true,
          },
        ],
      },
    ],
  },
};

test("selectBalconRatePlan picks Balcão only", () => {
  const plans = SAMPLE_PAYLOAD.data.categories[0]!.ratePlans!;
  const balcao = selectBalconRatePlan(plans);
  assert.equal(balcao?.channelName, "Balcão");
  assert.equal(balcao?.totalPrice, 210);
  assert.equal(isBalconRatePlan({ channelName: "Motor de reserva" }), false);
});

test("formatQuoteStayPeriod formats checkin and checkout", () => {
  assert.equal(formatQuoteStayPeriod(SAMPLE_PAYLOAD.data), "03/08/2026 a 04/08/2026");
});

test("buildModeloC6OptionsReply uses Balcão with period, diária and total", () => {
  const reply = buildModeloC6OptionsReply(SAMPLE_PAYLOAD);
  assert.match(reply, /03\/08\/2026 a 04\/08\/2026/);
  assert.match(reply, /Suíte Executiva/i);
  assert.match(reply, /R\$ 210,00 \/ diária · R\$ 210,00 total/);
  assert.match(reply, /Suíte Deluxe/i);
  assert.match(reply, /R\$ 380,00 \/ diária · R\$ 380,00 total/);
  assert.match(reply, /Qual opção você prefere/i);
  assert.doesNotMatch(reply, /Motor de reserva|REEMBOLSAVEL|Balcão/i);
});

test("replyLooksLikeModeloC6Options detects formatted quote", () => {
  const reply = buildModeloC6OptionsReply(SAMPLE_PAYLOAD);
  assert.equal(replyLooksLikeModeloC6Options(reply), true);
});

test("messageLooksLikeQuoteDiscountObjection detects price complaints", () => {
  assert.equal(messageLooksLikeQuoteDiscountObjection("está muito caro"), true);
  assert.equal(messageLooksLikeQuoteDiscountObjection("tem desconto?"), true);
  assert.equal(messageLooksLikeQuoteDiscountObjection("1"), false);
});

test("buildModeloC6DiscountTransferOfferReply does not promise discount", () => {
  const reply = buildModeloC6DiscountTransferOfferReply();
  assert.match(reply, /Não posso conceder descontos/i);
  assert.match(reply, /transferir.*equipe de atendimento/i);
  assert.doesNotMatch(reply, /claro|com certeza|posso dar desconto/i);
});

test("isBalconRatePlan accepts channelId 138 when name is empty", () => {
  assert.equal(isBalconRatePlan({ channelId: 138, available: true }), true);
  assert.equal(isBalconRatePlan({ channelId: 99, channelName: "Motor de reserva" }), false);
});

test("buildQuoteOptionsCatalogFromPayload stores Balcão prices for all categories", () => {
  const catalog = buildQuoteOptionsCatalogFromPayload(SAMPLE_PAYLOAD);
  assert.ok(catalog);
  assert.equal(catalog!.options.length, 2);
  assert.equal(catalog!.options[0]!.totalPrice, 210);
  assert.equal(catalog!.options[1]!.totalPrice, 380);
  assert.equal(catalog!.guests, 2);
});

test("buildModeloC6HandoffReply renders full summary before transfer", () => {
  const ctx = resolveQuoteHandoffContext({
    userMessage: "Suíte Deluxe",
    lastAssistantMessage: buildModeloC6OptionsReply(SAMPLE_PAYLOAD),
    lastOptionsPayload: SAMPLE_PAYLOAD,
    flowSlots: { establishmentName: "Vivá Porto de Galinhas" },
  });
  const reply = buildModeloC6HandoffReply(ctx);
  assert.match(reply, /Perfeito! Então temos/i);
  assert.match(reply, /Vivá Porto de Galinhas/);
  assert.match(reply, /03\/08\/2026/);
  assert.match(reply, /04\/08\/2026/);
  assert.match(reply, /Suíte Deluxe/);
  assert.match(reply, /Quantidade de pessoas: 2/);
  assert.match(reply, /R\$ 380,00 total/);
  assert.match(reply, /encaminhar seu atendimento para nossa equipe/i);
});

const BROOKLIN_PAYLOAD = {
  data: {
    establishmentId: 51,
    establishmentName: "Hotel Brooklin",
    checkin: "2026-08-03",
    checkout: "2026-08-04",
    guests: 2,
    categories: [
      {
        categoryName: "Standard Quadruplo (4 camas)",
        available: true,
        ratePlans: [
          {
            channelName: "Balcão",
            totalPrice: 210,
            averageNightlyPrice: 210,
            available: true,
          },
        ],
      },
      {
        categoryName: "Garagem Coberta",
        available: true,
        ratePlans: [
          {
            channelName: "Balcão",
            totalPrice: 50,
            averageNightlyPrice: 50,
            available: true,
          },
        ],
      },
    ],
  },
};

test("buildModeloC6OptionsReply omits garage categories for Hotel Brooklin", () => {
  const reply = buildModeloC6OptionsReply(BROOKLIN_PAYLOAD);
  assert.match(reply, /Standard Quadruplo/i);
  assert.doesNotMatch(reply, /Garagem|garagem/i);
  const catalog = buildQuoteOptionsCatalogFromPayload(BROOKLIN_PAYLOAD);
  assert.equal(catalog?.options.length, 1);
  assert.match(catalog!.options[0]!.categoryName, /Standard/i);
});

const BROOKLIN_5_GUESTS_PAYLOAD = {
  data: {
    establishmentId: 51,
    establishmentName: "Hotel Brooklin",
    checkin: "2026-08-02",
    checkout: "2026-08-04",
    guests: 5,
    nights: 2,
    categories: [
      {
        categoryName: "Z - Garagem",
        capacity: 1,
        minAvailableUnits: 5,
        available: true,
        ratePlans: [
          { channelName: "Balcão", channelId: 145, totalPrice: 500, averageNightlyPrice: 250, available: true },
        ],
      },
      {
        categoryName: "Standard Quadruplo (4 camas)",
        capacity: 4,
        minAvailableUnits: 3,
        available: true,
        ratePlans: [
          { channelName: "Balcão", channelId: 145, totalPrice: 956, averageNightlyPrice: 478, available: true },
        ],
      },
      {
        categoryName: "Econômico Duplo Casal",
        capacity: 2,
        minAvailableUnits: 5,
        available: true,
        ratePlans: [
          { channelName: "Balcão", channelId: 145, totalPrice: 1200, averageNightlyPrice: 600, available: true },
        ],
      },
      {
        categoryName: "Standard Duplo Casal",
        capacity: 2,
        minAvailableUnits: 4,
        available: true,
        ratePlans: [
          { channelName: "Balcão", channelId: 145, totalPrice: 1260, averageNightlyPrice: 630, available: true },
        ],
      },
      {
        categoryName: "Standard Duplo Solteiro",
        capacity: 2,
        minAvailableUnits: 5,
        available: true,
        ratePlans: [
          { channelName: "Balcão", channelId: 145, totalPrice: 1188, averageNightlyPrice: 594, available: true },
        ],
      },
    ],
  },
};

test("buildModeloC6OptionsReply shows room combinations for 5+ guests", () => {
  const reply = buildModeloC6OptionsReply(BROOKLIN_5_GUESTS_PAYLOAD);
  assert.match(reply, /Para 5 hóspedes/i);
  assert.match(reply, /combinações de quartos/i);
  assert.match(reply, /Standard Quadruplo \(4 camas\)/i);
  assert.match(reply, /total/i);
  assert.match(reply, /Qual opção você prefere/i);
  assert.doesNotMatch(reply, /Garagem|garagem/i);
  assert.match(reply, /\+/);
});

test("buildQuoteOptionsCatalogFromPayload stores combo labels for 5 guests", () => {
  const catalog = buildQuoteOptionsCatalogFromPayload(BROOKLIN_5_GUESTS_PAYLOAD);
  assert.ok(catalog);
  assert.equal(catalog!.guests, 5);
  assert.ok(catalog!.options.length >= 2);
  assert.match(catalog!.options[0]!.categoryName, /\+/);
  assert.ok(catalog!.options[0]!.totalPrice != null && catalog!.options[0]!.totalPrice! > 0);
});

test("resolveQuoteHandoffContext resolves combo choice by number", () => {
  const optionsReply = buildModeloC6OptionsReply(BROOKLIN_5_GUESTS_PAYLOAD);
  const catalog = buildQuoteOptionsCatalogFromPayload(BROOKLIN_5_GUESTS_PAYLOAD)!;
  const ctx = resolveQuoteHandoffContext({
    userMessage: "2",
    lastAssistantMessage: optionsReply,
    lastOptionsPayload: BROOKLIN_5_GUESTS_PAYLOAD,
    flowSlots: {
      establishmentName: "Hotel Brooklin",
      __quoteOptionsCatalog: JSON.stringify(catalog),
    },
  });
  assert.ok(ctx);
  assert.match(ctx!.chosenCategory, /\+/);
  assert.equal(ctx!.guests, 5);
  assert.ok(ctx!.totalPrice != null && ctx!.totalPrice > 0);
});

test("replyShouldPreemptEscalationTransferMessage detects Modelo C6 Escolha Confirm", () => {
  const handoff = buildModeloC6HandoffReply({
    chosenCategory: "Suíte Deluxe",
    establishmentName: "Hotel Brooklin",
    checkinDate: "02/08/2026",
    checkoutDate: "04/08/2026",
    guests: 5,
    totalPrice: 2144,
  });
  assert.equal(replyShouldPreemptEscalationTransferMessage(handoff), true);
});
