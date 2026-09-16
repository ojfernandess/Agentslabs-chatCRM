import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INTERACTION_NEAR_LIMIT_THRESHOLD,
  parseInteractionLimitFromBehavior,
  deriveBudgetStatus,
  buildInteractionBudgetPromptAppendix,
  type InteractionBudgetState,
} from "./interactionBudget.js";

describe("parseInteractionLimitFromBehavior", () => {
  it("returns disabled for missing/invalid behavior config", () => {
    assert.deepEqual(parseInteractionLimitFromBehavior(null), {
      enabled: false,
      limit: null,
      offerWebchatOnLimit: false,
    });
    assert.deepEqual(parseInteractionLimitFromBehavior(undefined), {
      enabled: false,
      limit: null,
      offerWebchatOnLimit: false,
    });
    assert.deepEqual(parseInteractionLimitFromBehavior("x"), {
      enabled: false,
      limit: null,
      offerWebchatOnLimit: false,
    });
    assert.deepEqual(parseInteractionLimitFromBehavior({}), {
      enabled: false,
      limit: null,
      offerWebchatOnLimit: false,
    });
    assert.deepEqual(parseInteractionLimitFromBehavior({ interactionLimit: "10" }), {
      enabled: false,
      limit: null,
      offerWebchatOnLimit: false,
    });
  });

  it("returns disabled when toggle is off even with a limit set (interaction_limit = null)", () => {
    assert.deepEqual(
      parseInteractionLimitFromBehavior({ interactionLimit: { enabled: false, limit: 10 } }),
      { enabled: false, limit: null, offerWebchatOnLimit: false },
    );
  });

  it("returns disabled when enabled but the limit is invalid", () => {
    assert.deepEqual(
      parseInteractionLimitFromBehavior({ interactionLimit: { enabled: true, limit: "dez" } }),
      { enabled: false, limit: null, offerWebchatOnLimit: false },
    );
    assert.deepEqual(
      parseInteractionLimitFromBehavior({ interactionLimit: { enabled: true } }),
      { enabled: false, limit: null, offerWebchatOnLimit: false },
    );
  });

  it("parses the configured limit (Editar Agente → Controle de atendimento)", () => {
    assert.deepEqual(
      parseInteractionLimitFromBehavior({ interactionLimit: { enabled: true, limit: 10 } }),
      { enabled: true, limit: 10, offerWebchatOnLimit: false },
    );
    assert.deepEqual(
      parseInteractionLimitFromBehavior({
        interactionLimit: { enabled: true, limit: 10, offerWebchatOnLimit: true },
      }),
      { enabled: true, limit: 10, offerWebchatOnLimit: true },
    );
  });

  it("clamps out-of-range limits to [1, 500] and floors fractions", () => {
    assert.equal(
      parseInteractionLimitFromBehavior({ interactionLimit: { enabled: true, limit: 0 } }).limit,
      1,
    );
    assert.equal(
      parseInteractionLimitFromBehavior({ interactionLimit: { enabled: true, limit: 9999 } }).limit,
      500,
    );
    assert.equal(
      parseInteractionLimitFromBehavior({ interactionLimit: { enabled: true, limit: 10.9 } }).limit,
      10,
    );
  });
});

describe("deriveBudgetStatus — status transitions (spec §16)", () => {
  it("stays ACTIVE far from the limit (1/10 … 6/10)", () => {
    for (let count = 0; count <= 6; count++) {
      assert.equal(deriveBudgetStatus(count, 10), "ACTIVE", `count=${count}`);
    }
  });

  it("becomes NEAR_LIMIT when remaining <= 3 (7/10, 8/10, 9/10)", () => {
    assert.equal(INTERACTION_NEAR_LIMIT_THRESHOLD, 3);
    for (const count of [7, 8, 9]) {
      assert.equal(deriveBudgetStatus(count, 10), "NEAR_LIMIT", `count=${count}`);
    }
  });

  it("becomes LIMIT_REACHED exactly at the limit (10/10) — never an 11th message", () => {
    assert.equal(deriveBudgetStatus(10, 10), "LIMIT_REACHED");
    assert.equal(deriveBudgetStatus(11, 10), "LIMIT_REACHED");
  });

  it("channel switch does not restart the counter: WhatsApp 7 + WebChat 3 = LIMIT_REACHED", () => {
    // O contador pertence à conversation_id — a soma dos canais é um único contador.
    const whatsappInteractions = 7;
    const webchatInteractions = 3;
    assert.equal(deriveBudgetStatus(whatsappInteractions + webchatInteractions, 10), "LIMIT_REACHED");
  });

  it("small limits: NEAR_LIMIT from the first message when limit <= 4", () => {
    assert.equal(deriveBudgetStatus(1, 3), "NEAR_LIMIT");
    assert.equal(deriveBudgetStatus(3, 3), "LIMIT_REACHED");
  });
});

describe("buildInteractionBudgetPromptAppendix — Modo Economia (spec §34)", () => {
  const state = (count: number, limit: number): InteractionBudgetState => ({
    enabled: true,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    status: deriveBudgetStatus(count, limit),
    blocked: count >= limit,
    nearLimit: limit - count <= INTERACTION_NEAR_LIMIT_THRESHOLD && count < limit,
  });

  it("is empty when the budget is disabled", () => {
    const disabled: InteractionBudgetState = {
      enabled: false,
      count: 0,
      limit: null,
      remaining: null,
      status: "DISABLED",
      blocked: false,
      nearLimit: false,
    };
    assert.equal(buildInteractionBudgetPromptAppendix(disabled), "");
  });

  it("is empty while the conversation is far from the limit (no invasive behavior change)", () => {
    assert.equal(buildInteractionBudgetPromptAppendix(state(3, 10)), "");
  });

  it("provides runtime metadata when remaining <= 3 (7/10)", () => {
    const appendix = buildInteractionBudgetPromptAppendix(state(7, 10));
    assert.ok(appendix.includes('"interaction_count":7'));
    assert.ok(appendix.includes('"interaction_limit":10'));
    assert.ok(appendix.includes('"remaining_interactions":3'));
    assert.ok(!appendix.includes("generate_webchat_link"));
  });

  it("instructs sending the Web Chat link only when offerWebchatOnLimit is enabled", () => {
    const appendix = buildInteractionBudgetPromptAppendix(state(7, 10), {
      offerWebchatOnLimit: true,
      webchatUrl: "https://chat.example.com/s/abc",
    });
    assert.ok(appendix.includes("https://chat.example.com/s/abc"));
    assert.ok(appendix.includes("Web Chat"));
  });

  it("instructs the agent to hand off on the LAST allowed reply (remaining = 1)", () => {
    const appendix = buildInteractionBudgetPromptAppendix(state(9, 10));
    assert.ok(appendix.includes("ÚLTIMA resposta automática"));
    assert.ok(appendix.includes("encaminhar"));
  });

  it("does not tell the agent it is the last reply when remaining > 1", () => {
    const appendix = buildInteractionBudgetPromptAppendix(state(7, 10));
    assert.ok(!appendix.includes("ÚLTIMA resposta automática"));
  });
});
