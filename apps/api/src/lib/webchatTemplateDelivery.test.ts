import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebchatComponentsFromMetaDefinition,
  buildWebchatTemplateComponents,
  webchatTemplateBodyParameters,
  webchatTemplateSuffix,
} from "./webchatTemplateDelivery.js";

test("webchat suffix is a single path segment without a slash", () => {
  assert.equal(webchatTemplateSuffix("abc_DEF-123"), "abc_DEF-123");
  assert.equal(webchatTemplateSuffix("abc_DEF-123").includes("/"), false);
});

test("named {{webchat}} fills only the body when the fallback has no button definition", () => {
  const suffix = "token";
  const components = buildWebchatTemplateComponents(
    "Continue em https://chat.agentslabs.cloud/{{webchat}}",
    suffix,
  );
  assert.equal(components.length, 1);
  assert.equal(components[0]?.type, "body");
  assert.deepEqual(
    (components[0]?.parameters as { text: string; parameter_name: string }[])[0],
    { type: "text", text: suffix, parameter_name: "webchat" },
  );
  assert.deepEqual(webchatTemplateBodyParameters("Olá {{webchat}}", suffix), [suffix]);
});

test("approved template fills the parameter where Meta declared it", () => {
  const token = "token";
  const positionalUrl = buildWebchatComponentsFromMetaDefinition(
    [
      { type: "BODY", text: "Toque no botão para continuar." },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Abrir", url: "https://chat.agentslabs.cloud/{{1}}" }],
      },
    ],
    token,
  );
  assert.equal(positionalUrl.length, 1);
  assert.equal(positionalUrl[0]?.type, "button");
  assert.equal(positionalUrl[0]?.index, "0");
  assert.deepEqual(positionalUrl[0]?.parameters, [{ type: "text", text: token }]);

  const namedUrl = buildWebchatComponentsFromMetaDefinition(
    [
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Ok" },
          { type: "URL", text: "Abrir", url: "https://chat.agentslabs.cloud/{{webchat}}" },
        ],
      },
    ],
    token,
  );
  assert.equal(namedUrl[0]?.index, "1");
  assert.deepEqual(namedUrl[0]?.parameters, [
    { type: "text", text: token, parameter_name: "webchat" },
  ]);
});

test("button-only template does not invent body variables", () => {
  const components = buildWebchatTemplateComponents("Abra o atendimento", "token");
  assert.equal(components.length, 1);
  assert.equal(components[0]?.type, "button");
  assert.deepEqual(webchatTemplateBodyParameters("Abra o atendimento", "token"), []);
});

test("foreign body variables are rejected", () => {
  assert.throws(() => buildWebchatTemplateComponents("Olá {{nome}} {{webchat}}", "s/token"));
});
