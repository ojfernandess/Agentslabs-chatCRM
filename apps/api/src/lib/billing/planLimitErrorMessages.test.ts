import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlanLimitExceededMessages } from "./planLimitErrorMessages.js";

describe("planLimitErrorMessages", () => {
  it("builds friendly PT/EN messages for agent limits", () => {
    const { message, messageEn } = buildPlanLimitExceededMessages({
      planName: "Starter",
      dimension: "agents",
      used: 1,
      limit: 1,
    });
    assert.match(message, /plano «Starter»/);
    assert.match(message, /1 agente IA/);
    assert.match(message, /upgrade do plano/i);
    assert.match(messageEn, /Starter/);
    assert.match(messageEn, /AI agent/);
    assert.match(messageEn, /upgrade your plan/i);
  });

  it("builds friendly messages for team user limits", () => {
    const { message, messageEn } = buildPlanLimitExceededMessages({
      planName: "Plano Personalizado ACME",
      dimension: "users",
      used: 3,
      limit: 3,
    });
    assert.match(message, /3 usuários/);
    assert.match(message, /Plano Personalizado ACME/);
    assert.match(messageEn, /3 users/);
  });

  it("builds friendly messages for automation limits", () => {
    const { message } = buildPlanLimitExceededMessages({
      planName: null,
      dimension: "automations",
      used: 2,
      limit: 2,
    });
    assert.match(message, /seu plano atual/);
    assert.match(message, /automações\/bots/);
  });
});
