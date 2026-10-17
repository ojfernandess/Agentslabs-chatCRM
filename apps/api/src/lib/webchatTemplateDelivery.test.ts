import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebchatTemplateComponents,
  webchatTemplateBodyParameters,
  webchatTemplateSuffix,
} from "./webchatTemplateDelivery.js";

test("webchat suffix is the path after the domain", () => {
  assert.equal(webchatTemplateSuffix("abc_DEF-123"), "s/abc_DEF-123");
});

test("named {{webchat}} fills the body and the URL button", () => {
  const suffix = "s/token";
  const components = buildWebchatTemplateComponents(
    "Continue em https://chat.agentslabs.cloud/{{webchat}}",
    suffix,
  );
  assert.equal(components.length, 2);
  assert.equal(components[0]?.type, "body");
  assert.deepEqual(
    (components[0]?.parameters as { text: string; parameter_name: string }[])[0],
    { type: "text", text: suffix, parameter_name: "webchat" },
  );
  assert.equal(components[1]?.type, "button");
  assert.equal(components[1]?.sub_type, "url");
  assert.deepEqual(webchatTemplateBodyParameters("Olá {{webchat}}", suffix), [suffix]);
});

test("button-only template does not invent body variables", () => {
  const components = buildWebchatTemplateComponents("Abra o atendimento", "s/token");
  assert.equal(components.length, 1);
  assert.equal(components[0]?.type, "button");
  assert.deepEqual(webchatTemplateBodyParameters("Abra o atendimento", "s/token"), []);
});

test("foreign body variables are rejected", () => {
  assert.throws(() => buildWebchatTemplateComponents("Olá {{nome}} {{webchat}}", "s/token"));
});
