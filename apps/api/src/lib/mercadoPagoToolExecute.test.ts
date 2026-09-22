import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./billing/test/billingTestEnv.js";
import {
  buildMercadoPagoAgentToolDescription,
  buildOrganizationMercadoPagoToolMetadata,
  isMercadoPagoAutomationTool,
  isOrganizationAgentMercadoPagoMetadata,
  normalizeMercadoPagoLlmArgs,
  parseMercadoPagoAction,
  readMercadoPagoToolConfig,
} from "./mercadoPagoToolExecute.js";

describe("mercadoPagoToolExecute helpers", () => {
  it("detects MERCADO_PAGO tool type and mercadopago integration", () => {
    assert.equal(isMercadoPagoAutomationTool({ toolType: "MERCADO_PAGO", config: {} }), true);
    assert.equal(
      isMercadoPagoAutomationTool({ toolType: "INTEGRATION", config: { provider: "mercadopago" } }),
      true,
    );
    assert.equal(
      isMercadoPagoAutomationTool({ toolType: "INTEGRATION", config: { provider: "slack" } }),
      false,
    );
  });

  it("reads mercado pago config defaults", () => {
    const cfg = readMercadoPagoToolConfig({
      accessToken: "APP_USR_test",
      successUrl: "https://example.com/ok",
      defaultAmountCents: 9900,
      currency: "BRL",
    });
    assert.equal(cfg.accessToken, "APP_USR_test");
    assert.equal(cfg.successUrl, "https://example.com/ok");
    assert.equal(cfg.defaultAmountCents, 9900);
    assert.equal(cfg.currency, "BRL");
  });

  it("parses supported actions and aliases", () => {
    assert.equal(parseMercadoPagoAction("list_plans"), "list_plans");
    assert.equal(parseMercadoPagoAction("create_payment_link"), "create_checkout_preference");
    assert.equal(parseMercadoPagoAction("pix_payment"), "create_pix_payment");
    assert.equal(parseMercadoPagoAction("unknown"), null);
  });

  it("merges legacy params object into llm args", () => {
    const merged = normalizeMercadoPagoLlmArgs({
      action: "create_pix_payment",
      params: { amountCents: 5000, payerEmail: "a@b.com" },
    });
    assert.equal(merged.amountCents, 5000);
    assert.equal(merged.payerEmail, "a@b.com");
    assert.equal(merged.action, "create_pix_payment");
  });

  it("builds agent description with configured defaults", () => {
    const desc = buildMercadoPagoAgentToolDescription({
      defaultAmountCents: 9900,
      currency: "BRL",
      webhookSecret: "secret",
    });
    assert.match(desc, /9900/);
    assert.match(desc, /paymentStatus=paid/);
  });

  it("builds agent tool metadata for webhook correlation", () => {
    const meta = buildOrganizationMercadoPagoToolMetadata({
      organizationId: "org-1",
      conversationId: "conv-1",
      toolId: "tool-1",
    });
    assert.equal(meta.openconduitToolScope, "organization_agent_mercadopago");
    assert.equal(isOrganizationAgentMercadoPagoMetadata(meta), true);
    assert.equal(isOrganizationAgentMercadoPagoMetadata({ foo: "bar" }), false);
  });
});
