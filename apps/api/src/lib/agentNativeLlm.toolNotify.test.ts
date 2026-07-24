import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicReplyFromKnowledge,
  buildDeterministicReplyFromToolOutcomes,
  hasSubstantiveAgentReplyToCustomer,
  isLikelyStallOnlyReply,
  knowledgeToolFoundUsefulExcerpts,
  parseToolCallNotifyFromBehavior,
  parseToolCallOutcomeFromJson,
  resolveToolCallNotifyBody,
  shouldEnsureToolResultFollowUp,
  shouldForceDeliveryAfterTools,
  shouldForceKnowledgeDelivery,
  userMessageLooksLikeKnowledgeSeekingQuery,
} from "./agentNativeLlm.js";

test("parseToolCallNotifyFromBehavior reads ensureResultDelivered and toolMessages", () => {
  const cfg = parseToolCallNotifyFromBehavior({
    toolCallNotify: {
      enabled: true,
      message: "Aguarde",
      selectedTools: ["custom:abc"],
      ensureResultDelivered: true,
      toolMessages: {
        "custom:abc": "A consultar a reserva…",
        "native:knowledge_search": "  ",
      },
    },
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.ensureResultDelivered, true);
  assert.equal(cfg.toolMessages["custom:abc"], "A consultar a reserva…");
  assert.equal(cfg.toolMessages["native:knowledge_search"], undefined);
});

test("resolveToolCallNotifyBody prefers per-tool message then global", () => {
  assert.equal(
    resolveToolCallNotifyBody({
      assistantContent: null,
      toolNames: ["buscar_conhecimento"],
      defaultMessage: "Global",
      toolMessages: { "native:knowledge_search": "A pesquisar na base…" },
    }),
    "A pesquisar na base…",
  );
  assert.equal(
    resolveToolCallNotifyBody({
      assistantContent: null,
      toolNames: ["buscar_conhecimento"],
      defaultMessage: "Global",
      toolMessages: {},
    }),
    "Global",
  );
  assert.equal(
    resolveToolCallNotifyBody({
      assistantContent: "Já estou a verificar",
      toolNames: ["buscar_conhecimento"],
      defaultMessage: "Global",
      toolMessages: { "native:knowledge_search": "A pesquisar…" },
    }),
    "Já estou a verificar",
  );
});

test("parseToolCallOutcomeFromJson extracts ok and preview", () => {
  const out = parseToolCallOutcomeFromJson(
    "oc_tool_test",
    JSON.stringify({ ok: true, bodyPreview: '{"message":"ok"}' }),
  );
  assert.equal(out.ok, true);
  assert.match(out.preview, /message/);
});

test("parseToolCallOutcomeFromJson treats buscar_conhecimento found as ok", () => {
  const out = parseToolCallOutcomeFromJson(
    "buscar_conhecimento",
    JSON.stringify({
      found: true,
      articles: [{ title: "Club", excerpt: "Endereço: Rua A" }],
    }),
  );
  assert.equal(out.ok, true);
});

test("shouldEnsureToolResultFollowUp when reply is stall-only after monitored tools", () => {
  const outcomes = [
    { name: "oc_tool_a", ok: true, preview: "data", monitored: true },
    { name: "oc_tool_b", ok: false, preview: "fail", monitored: false },
  ];
  assert.equal(
    shouldEnsureToolResultFollowUp({
      ensureResultDelivered: true,
      toolOutcomes: outcomes,
      replyText: "Só um momento por gentileza",
    }),
    true,
  );
  assert.equal(
    shouldEnsureToolResultFollowUp({
      ensureResultDelivered: true,
      toolOutcomes: outcomes,
      replyText: "O seu check-in foi concluído com sucesso. Código: ABC123.",
    }),
    false,
  );
  assert.equal(hasSubstantiveAgentReplyToCustomer("O check-in foi concluído."), true);
});

test("isLikelyStallOnlyReply catches interim notify phrase", () => {
  assert.equal(isLikelyStallOnlyReply("Só um momento por gentileza"), true);
  assert.equal(
    isLikelyStallOnlyReply(
      "Não foi possível concluir as ações automáticas a tempo. Um agente humano irá ajudá-lo em seguida.",
    ),
    true,
  );
  assert.equal(isLikelyStallOnlyReply("O endereço é Rua Acruás, 267."), false);
});

test("parseToolCallNotifyFromBehavior defaults force delivery on (legacy)", () => {
  const cfg = parseToolCallNotifyFromBehavior({
    toolCallNotify: { enabled: true, message: "Aguarde" },
  });
  assert.equal(cfg.forceDeliveryEnabled, true);
  assert.equal(cfg.forceDeliveryTools, null);
  assert.equal(cfg.forceKnowledgeRescue, true);
});

test("parseToolCallNotifyFromBehavior reads force delivery toggles and tool filter", () => {
  const cfg = parseToolCallNotifyFromBehavior({
    toolCallNotify: {
      enabled: false,
      forceDeliveryEnabled: false,
      forceKnowledgeRescue: false,
      forceDeliveryTools: ["custom:abc", "native:create_reservation"],
    },
  });
  assert.equal(cfg.forceDeliveryEnabled, false);
  assert.equal(cfg.forceKnowledgeRescue, false);
  assert.deepEqual(cfg.forceDeliveryTools, ["custom:abc", "native:create_reservation"]);
});

test("shouldForceDeliveryAfterTools respects enable and tool filter", () => {
  const toolId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const outcomes = [
    {
      name: `oc_tool_${toolId.replace(/-/g, "")}`,
      ok: true,
      preview: '{"found":true}',
      monitored: true,
    },
  ];
  assert.equal(
    shouldForceDeliveryAfterTools({
      toolOutcomes: outcomes,
      replyText: "",
      forceDeliveryEnabled: false,
    }),
    false,
  );
  assert.equal(
    shouldForceDeliveryAfterTools({
      toolOutcomes: outcomes,
      replyText: "",
      forceDeliveryEnabled: true,
      forceDeliveryTools: [],
    }),
    false,
  );
  assert.equal(
    shouldForceDeliveryAfterTools({
      toolOutcomes: outcomes,
      replyText: "",
      forceDeliveryEnabled: true,
      forceDeliveryTools: ["custom:bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
    }),
    false,
  );
  assert.equal(
    shouldForceDeliveryAfterTools({
      toolOutcomes: outcomes,
      replyText: "",
      forceDeliveryEnabled: true,
      forceDeliveryTools: [`custom:${toolId}`],
    }),
    true,
  );
});

test("shouldForceKnowledgeDelivery respects forceKnowledgeRescue off", () => {
  assert.equal(
    shouldForceKnowledgeDelivery({
      replyText: "Só um momento por gentileza",
      kbHasUsefulExcerpts: true,
      toolOutcomes: [],
      userMessage: "Qual o endereço da Club Suítes?",
      forceKnowledgeRescue: false,
    }),
    false,
  );
  assert.equal(
    shouldForceKnowledgeDelivery({
      replyText: "Só um momento por gentileza",
      kbHasUsefulExcerpts: true,
      toolOutcomes: [],
      userMessage: "Qual o endereço da Club Suítes?",
      forceDeliveryEnabled: false,
    }),
    false,
  );
});

test("shouldForceDeliveryAfterTools when empty or stall after any tools", () => {
  const outcomes = [{ name: "oc_tool_reserva", ok: true, preview: '{"found":true}', monitored: true }];
  assert.equal(shouldForceDeliveryAfterTools({ toolOutcomes: outcomes, replyText: "" }), true);
  assert.equal(
    shouldForceDeliveryAfterTools({ toolOutcomes: outcomes, replyText: "Só um momento por gentileza" }),
    true,
  );
  assert.equal(
    shouldForceDeliveryAfterTools({
      toolOutcomes: outcomes,
      replyText: "Encontrei a sua reserva para amanhã.",
    }),
    false,
  );
  assert.equal(shouldForceDeliveryAfterTools({ toolOutcomes: [], replyText: "" }), false);
  assert.equal(
    shouldForceDeliveryAfterTools({
      toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: '{"found":true}', monitored: false }],
      replyText: "Só um momento por gentileza",
    }),
    false,
  );
});

test("shouldForceKnowledgeDelivery when stall with useful appendix", () => {
  assert.equal(
    shouldForceKnowledgeDelivery({
      replyText: "Só um momento por gentileza",
      kbHasUsefulExcerpts: true,
      toolOutcomes: [],
      userMessage: "Qual o endereço da Club Suítes?",
    }),
    true,
  );
  assert.equal(
    shouldForceKnowledgeDelivery({
      replyText: "O Wi-Fi é @@vivapp e a rede é Club.",
      kbHasUsefulExcerpts: true,
      toolOutcomes: [],
      userMessage: "Qual o Wi-Fi?",
    }),
    false,
  );
});

test("shouldForceKnowledgeDelivery skips CPF/tool flow with proactive appendix", () => {
  const httpTool = {
    name: "oc_tool_consultar_main_guest",
    ok: true,
    preview: JSON.stringify({ data: { found: false } }),
    monitored: true,
  };
  assert.equal(
    shouldForceKnowledgeDelivery({
      replyText: "Não encontrei o cadastro com esse documento. Pode confirmar o CPF?",
      kbHasUsefulExcerpts: true,
      toolOutcomes: [httpTool],
      userMessage: "699.606.761-88",
    }),
    false,
  );
  assert.equal(
    shouldForceKnowledgeDelivery({
      replyText: "Só um momento por gentileza",
      kbHasUsefulExcerpts: true,
      toolOutcomes: [httpTool],
      userMessage: "699.606.761-88",
    }),
    false,
  );
  assert.equal(userMessageLooksLikeKnowledgeSeekingQuery("699.606.761-88"), false);
  assert.equal(userMessageLooksLikeKnowledgeSeekingQuery("Qual o Wi-Fi da unidade?"), true);
});

test("buildDeterministicReplyFromKnowledge uses appendix excerpts", () => {
  const appendix =
    "\n\n### Base de conhecimento (excertos recuperados automaticamente)\n" +
    "**1. Club Suítes — Base** (relevância 0.8)\n" +
    "Endereço: Rua Acruás, 267 – Campo Belo, São Paulo – SP.\nWiFi senha @@vivapp\n\n" +
    "**Instruções:** a sua mensagem ao cliente deve incorporar factos.";
  const text = buildDeterministicReplyFromKnowledge({
    userMessage: "Qual o endereço?",
    proactiveAppendix: appendix,
  });
  assert.match(text, /Acruás/);
  assert.equal(hasSubstantiveAgentReplyToCustomer(text), true);
});

test("buildDeterministicReplyFromToolOutcomes uses tool preview when LLM fails", () => {
  const text = buildDeterministicReplyFromToolOutcomes([
    {
      name: "buscar_conhecimento",
      ok: true,
      preview: "kb noise",
      monitored: false,
    },
    {
      name: "oc_tool_consultar_reserva",
      ok: true,
      preview: JSON.stringify({ message: "Reserva confirmada para 22/07." }),
      monitored: true,
    },
  ]);
  assert.match(text, /Reserva confirmada/);
  assert.equal(hasSubstantiveAgentReplyToCustomer(text), true);
});

test("knowledgeToolFoundUsefulExcerpts detects found true", () => {
  assert.equal(
    knowledgeToolFoundUsefulExcerpts([
      {
        name: "buscar_conhecimento",
        ok: true,
        preview: JSON.stringify({ found: true, articles: [{ excerpt: "x" }] }),
        monitored: false,
      },
    ]),
    true,
  );
});
