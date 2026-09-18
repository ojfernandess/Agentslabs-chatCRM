import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTemplateBodyParametersFromMetaComponents,
  externalSendTemplateBodySchema,
  normalizeExternalSendTemplatePayload,
  phoneDigitsOnly,
  sanitizeMetaTemplateComponentsForSend,
} from "./externalSendTemplateHelpers.js";

test("externalSendTemplateBodySchema accepts nested SuperAgents payload", () => {
  const r = externalSendTemplateBodySchema.safeParse({
    organizationId: "001bd4d2-7188-4f39-9907-1e6c802a5897",
    inboxId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    from: "5516988888888",
    to: "5516999999999",
    data: {
      templateId: "pedido_confirmado",
      sendToWA: true,
      inboxType: "ai",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", parameter_name: "nome", text: "João" }],
        },
      ],
    },
  });
  assert.equal(r.success, true);
});

test("normalizeExternalSendTemplatePayload merges organizationId and inboxId", () => {
  const out = normalizeExternalSendTemplatePayload({
    organizationId: "001bd4d2-7188-4f39-9907-1e6c802a5897",
    inboxId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    to: "5516999999999",
    data: {
      templateId: "tpl_1",
      sendToWA: true,
      inboxType: "human",
    },
  });
  assert.equal(out.organizationId, "001bd4d2-7188-4f39-9907-1e6c802a5897");
  assert.equal(out.inboxId, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  assert.equal(out.templateId, "tpl_1");
});

test("normalizeExternalSendTemplatePayload merges nested data", () => {
  const out = normalizeExternalSendTemplatePayload({
    from: "5516988888888",
    to: "5516999999999",
    data: {
      templateId: "tpl_1",
      sendToWA: false,
      inboxType: "human",
      components: [],
    },
  });
  assert.equal(out.templateId, "tpl_1");
  assert.equal(out.sendToWA, false);
  assert.equal(out.inboxType, "human");
});

test("extractTemplateBodyParametersFromMetaComponents reads body texts in order", () => {
  const params = extractTemplateBodyParametersFromMetaComponents([
    {
      type: "header",
      parameters: [{ type: "text", text: "Header" }],
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: "Maria" },
        { type: "text", text: "#4521" },
      ],
    },
  ]);
  assert.deepEqual(params, ["Maria", "#4521"]);
});

test("sanitizeMetaTemplateComponentsForSend strips parameter_name for Meta API", () => {
  const out = sanitizeMetaTemplateComponentsForSend([
    {
      type: "body",
      parameters: [{ type: "text", parameter_name: "nome", text: "Ana" }],
    },
  ]);
  assert.deepEqual(out, [
    {
      type: "body",
      parameters: [{ type: "text", text: "Ana" }],
    },
  ]);
});

test("phoneDigitsOnly normalizes display numbers", () => {
  assert.equal(phoneDigitsOnly("+55 (16) 98888-8888"), "5516988888888");
});
