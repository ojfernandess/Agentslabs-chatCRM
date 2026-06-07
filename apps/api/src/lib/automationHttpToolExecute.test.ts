import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHttpToolFlatContext,
  expandTemplateValue,
  extractInlineBodyFromArgs,
  resolveHttpRequestBody,
} from "./automationHttpToolExecute.js";

test("resolveHttpRequestBody uses inline args when body and bodyTemplate are absent", () => {
  const args = {
    mode: "digital",
    approveCheckin: true,
    mainGuest: {
      name: "João Carlos Silva",
      email: "joao.silva@teste.com",
    },
    sampleContext: {},
  };
  const flat = buildHttpToolFlatContext(args);
  const resolved = resolveHttpRequestBody({ cfg: { bodyTemplate: {} }, args, flat });
  assert.equal(resolved.source, "inline");
  const parsed = JSON.parse(resolved.bodyStr ?? "{}") as Record<string, unknown>;
  assert.equal(parsed.mode, "digital");
  assert.deepEqual(parsed.mainGuest, {
    name: "João Carlos Silva",
    email: "joao.silva@teste.com",
  });
});

test("resolveHttpRequestBody prefers explicit body over inline args", () => {
  const args = {
    body: { hello: "world" },
    mode: "ignored",
  };
  const flat = buildHttpToolFlatContext(args);
  const resolved = resolveHttpRequestBody({ cfg: {}, args, flat });
  assert.equal(resolved.source, "explicit");
  assert.equal(resolved.bodyStr, JSON.stringify({ hello: "world" }));
});

test("resolveHttpRequestBody expands bodyTemplate placeholders from sampleContext", () => {
  const args = {
    sampleContext: {
      nome: "Maria",
      email: "maria@teste.com",
    },
  };
  const flat = buildHttpToolFlatContext(args);
  const resolved = resolveHttpRequestBody({
    cfg: {
      bodyTemplate: {
        mainGuest: {
          name: "{{nome}}",
          email: "{{email}}",
        },
      },
    },
    args,
    flat,
  });
  assert.equal(resolved.source, "template");
  const parsed = JSON.parse(resolved.bodyStr ?? "{}") as {
    mainGuest: { name: string; email: string };
  };
  assert.equal(parsed.mainGuest.name, "Maria");
  assert.equal(parsed.mainGuest.email, "maria@teste.com");
});

test("extractInlineBodyFromArgs excludes reserved transport keys", () => {
  const inline = extractInlineBodyFromArgs({
    pathParams: { reservationId: "123" },
    query: { debug: "1" },
    headers: { "X-Test": "1" },
    body: { ignored: true },
    sampleContext: { nome: "Ana" },
    mode: "digital",
  });
  assert.deepEqual(inline, { mode: "digital" });
});

test("expandTemplateValue preserves arrays and nested objects", () => {
  const out = expandTemplateValue(
    {
      dependents: [{ name: "{{dep_name}}" }],
      mode: "{{mode}}",
    },
    { dep_name: "Filho", mode: "digital" },
  ) as Record<string, unknown>;
  assert.equal(out.mode, "digital");
  assert.deepEqual(out.dependents, [{ name: "Filho" }]);
});
