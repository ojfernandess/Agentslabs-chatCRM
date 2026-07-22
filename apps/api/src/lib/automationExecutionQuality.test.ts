import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeExecutionQualityFromLogs,
  analyzeLiveExecutionQuality,
  buildExecutionFlowGraph,
  detectConversationLoop,
} from "./automationExecutionQuality.js";

test("detects lost context when tool result unused in generic reply", () => {
  const signals = analyzeLiveExecutionQuality({
    userMessage: "Quero cancelar minha reserva.",
    replyText: "Como posso ajudá-lo?",
    toolOutcomes: [{ name: "getReservation", ok: true, preview: "Reserva #1234 confirmada para 12/07" }],
    outboundSent: true,
  });
  assert.ok(signals.some((s) => s.kind === "lost_context"));
});

test("detects possible hallucination when hotel name mismatches", () => {
  const signals = analyzeLiveExecutionQuality({
    userMessage: "Qual é meu hotel?",
    replyText: "Seu hotel é o Aero Plaza.",
    toolOutcomes: [{ name: "getHotel", ok: true, preview: '{"hotel":"Hotel Ocean"}' }],
    outboundSent: true,
  });
  assert.ok(signals.some((s) => s.kind === "possible_hallucination"));
});

test("detects tool not answered when no substantive reply", () => {
  const signals = analyzeLiveExecutionQuality({
    userMessage: "Status do pedido",
    replyText: "Só um momento por gentileza",
    toolOutcomes: [{ name: "getOrder", ok: true, preview: "Pedido enviado" }],
    outboundSent: false,
  });
  const hit = signals.find((s) => s.kind === "tool_not_answered");
  assert.ok(hit);
  assert.deepEqual(hit?.suggestedActions, ["send_now", "ignore", "retry"]);
});

test("detects ignored tool when balance intent without tool call", () => {
  const signals = analyzeLiveExecutionQuality({
    userMessage: "Quero meu saldo",
    replyText: "Seu saldo é R$ 120,00.",
    toolOutcomes: [],
    outboundSent: true,
  });
  assert.ok(signals.some((s) => s.kind === "tool_ignored"));
});

test("does not flag tool_ignored on OCR / data-collection turns", () => {
  const ocr = analyzeLiveExecutionQuality({
    userMessage: '[Transcrição de imagem]{"description":"CNH","extractedText":"123"}',
    replyText: "Documento recebido. Pode enviar a selfie?",
    toolOutcomes: [],
    outboundSent: true,
  });
  assert.ok(!ocr.some((s) => s.kind === "tool_ignored"));

  const collect = analyzeLiveExecutionQuality({
    userMessage: "documento",
    replyText: "Por favor envie a foto do documento de identidade.",
    toolOutcomes: [],
    outboundSent: true,
  });
  assert.ok(!collect.some((s) => s.kind === "tool_ignored"));
});

test("detects conversation loop", () => {
  assert.equal(
    detectConversationLoop({
      userMessage: "Quero cancelar",
      replyText: "Posso ajudar?",
      priorAgentReplies: ["Posso ajudar?"],
    }),
    true,
  );
});

test("buildExecutionFlowGraph creates ordered nodes", () => {
  const graph = buildExecutionFlowGraph([
    {
      id: "1",
      sequence: 1,
      level: "INFO",
      nodeId: "inbound",
      nodeName: "Webhook inbound",
      nodePath: "native_agent/inbound",
      message: "Mensagem recebida",
    },
    {
      id: "2",
      sequence: 2,
      level: "INFO",
      nodeId: "oc_tool_x",
      nodeName: "Tool: getBalance",
      nodePath: "native_agent/agent_llm/tools/oc_tool_x",
      message: "Chamada à ferramenta",
    },
    {
      id: "3",
      sequence: 3,
      level: "INFO",
      nodeId: "outbound",
      nodeName: "Entrega",
      nodePath: "native_agent/outbound",
      message: "Mensagem outbound enviada",
    },
  ]);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes[0]?.kind, "message");
  assert.equal(graph.nodes[1]?.kind, "tool");
  assert.equal(graph.nodes[2]?.kind, "response");
});

test("analyzeExecutionQualityFromLogs reads inbound user message", () => {
  const signals = analyzeExecutionQualityFromLogs([
    {
      id: "1",
      sequence: 1,
      level: "INFO",
      nodeId: "inbound",
      nodeName: "Webhook inbound",
      nodePath: "native_agent/inbound",
      message: "Mensagem recebida",
      inputContext: { userMessage: "Quero meu saldo" },
    },
    {
      id: "2",
      sequence: 2,
      level: "INFO",
      nodeId: "quality",
      nodeName: "Qualidade",
      nodePath: "native_agent/quality",
      message: "Snapshot",
      outputContext: { replyPreview: "Seu saldo é R$ 50" },
    },
  ]);
  assert.ok(signals.some((s) => s.kind === "tool_ignored"));
});
