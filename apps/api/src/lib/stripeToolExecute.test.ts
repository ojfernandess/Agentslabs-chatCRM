import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildStripeAgentToolDescription,
  buildOrganizationStripeToolMetadata,
  isOrganizationAgentStripeMetadata,
  isStripeAutomationTool,
  normalizeStripeLlmArgs,
  parseStripeAction,
  readStripeToolConfig,
} from "./stripeToolExecute.js";

describe("stripeToolExecute helpers", () => {
  it("detects STRIPE tool type and stripe integration", () => {
    assert.equal(isStripeAutomationTool({ toolType: "STRIPE", config: {} }), true);
    assert.equal(
      isStripeAutomationTool({ toolType: "INTEGRATION", config: { provider: "stripe" } }),
      true,
    );
    assert.equal(
      isStripeAutomationTool({ toolType: "INTEGRATION", config: { provider: "slack" } }),
      false,
    );
  });

  it("reads stripe config defaults", () => {
    const cfg = readStripeToolConfig({
      secretKey: "sk_test_x",
      successUrl: "https://example.com/ok",
      defaultPriceId: "price_123",
      currency: "BRL",
    });
    assert.equal(cfg.secretKey, "sk_test_x");
    assert.equal(cfg.successUrl, "https://example.com/ok");
    assert.equal(cfg.defaultPriceId, "price_123");
    assert.equal(cfg.currency, "brl");
    assert.equal(cfg.catalog.length, 1);
    assert.equal(cfg.catalog[0]?.priceId, "price_123");
  });

  it("parses supported actions and aliases", () => {
    assert.equal(parseStripeAction("list_prices"), "list_prices");
    assert.equal(parseStripeAction("generate_payment_link"), "create_payment_link");
    assert.equal(parseStripeAction("checkout"), "create_checkout_session");
    assert.equal(parseStripeAction("unknown"), null);
  });

  it("merges legacy params object into llm args", () => {
    const merged = normalizeStripeLlmArgs({
      action: "list_prices",
      params: { productId: "prod_1", currency: "usd" },
    });
    assert.equal(merged.productId, "prod_1");
    assert.equal(merged.currency, "usd");
    assert.equal(merged.action, "list_prices");
  });

  it("builds agent description with configured defaults", () => {
    const desc = buildStripeAgentToolDescription({
      defaultPriceId: "price_abc",
      successUrl: "https://loja.example/sucesso",
      cancelUrl: "https://loja.example/cancelar",
      webhookSecret: "whsec_test",
    });
    assert.match(desc, /price_abc/);
    assert.match(desc, /paymentStatus=paid/);
  });

  it("builds agent tool metadata for webhook correlation", () => {
    const meta = buildOrganizationStripeToolMetadata({
      organizationId: "org-1",
      conversationId: "conv-1",
      toolId: "tool-1",
    });
    assert.equal(meta.openconduitToolScope, "organization_agent");
    assert.equal(isOrganizationAgentStripeMetadata(meta), true);
    assert.equal(isOrganizationAgentStripeMetadata({ foo: "bar" }), false);
  });
});
