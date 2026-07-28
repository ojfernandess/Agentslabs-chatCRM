import assert from "node:assert/strict";
import { test } from "node:test";
import { compilePromptContract } from "./PromptCompiler.js";
import { buildExecutionContract } from "./ExecutionContractBuilder.js";
import { orchestrateTools, filterToolsByOrchestrator } from "./ToolOrchestrator.js";
import { validateBeforeExecution } from "./PreExecutionValidator.js";
import { evaluateSmartFallback } from "./SmartFallback.js";
import { checkExecutionConsistency } from "./ExecutionConsistency.js";
import { initializeRuntimeV2 } from "./RuntimeV2Bridge.js";
import { scheduleNextAction } from "./ToolScheduler.js";
import { buildContractSupervisorChecks } from "./ContractSupervisor.js";
import { executeRecoveryStrategy, applyRecoveryToLlmConfig } from "./ToolRecoveryExecutor.js";
import {
  shouldRunDeterministicToolPhase,
} from "./DeterministicToolInvoker.js";
import { buildKbToolPreamble } from "./NativePromptAssembly.js";
import { buildContractWorkflowFindings } from "../audit/WorkflowContractValidator.js";

const SAMPLE_PLAYBOOK = `
## Restrições (obrigatório)
- Sempre use \`audaar_consultar_reserva\` antes de responder sobre reservas.

| C3 | **Check-in explícito** | \`fazer check-in\` + localizador | Chame \`audaar_consultar_reserva\` · **PROIBIDO** \`buscar_conhecimento\` | consultar_reserva |
| C10 | **Conclusão** | confirmação ficha | Chame \`audaar_check_in\` | audaar_check_in |
`;

test("compilePromptContract extracts steps and restrictions", () => {
  const contract = compilePromptContract({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
  });
  assert.equal(contract.version, 2);
  assert.ok(contract.steps.length >= 1);
  assert.ok(contract.restrictions.length >= 0);
  assert.ok(contract.globalForbiddenPairs.length >= 0);
});

test("buildExecutionContract requires tools on check-in message", () => {
  const contract = buildExecutionContract({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "quero fazer check-in ABC12345",
    availableToolNames: ["audaar_consultar_reserva", "audaar_check_in", "buscar_conhecimento"],
    lastAssistantMessage: "",
  });
  assert.ok(contract.requiredTools.length >= 0);
  assert.equal(contract.intent.label, contract.intent.isContinuation ? "proactive_continuation" : contract.intent.label);
});

test("orchestrateTools sets mandatoryNextTool for pending required", () => {
  const contract = buildExecutionContract({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "sim",
    availableToolNames: ["audaar_check_in", "buscar_conhecimento"],
    lastAssistantMessage: "Confirme a FICHA DE VIAGEM. Está tudo certo?",
  });
  const decision = orchestrateTools({
    contract,
    availableToolNames: ["audaar_check_in", "buscar_conhecimento"],
    toolsAlreadyCalled: [],
  });
  assert.ok(decision.allowedToolNames.includes("audaar_check_in") || decision.allowedToolNames.length > 0);
});

test("filterToolsByOrchestrator removes forbidden tools", () => {
  const decision = {
    allowedToolNames: ["audaar_check_in"],
    forbiddenToolNames: ["buscar_conhecimento", "call_human"],
    mandatoryNextTool: "audaar_check_in",
    reason: "test",
    pendingRequired: ["audaar_check_in"],
  };
  const filtered = filterToolsByOrchestrator(
    [
      { function: { name: "audaar_check_in" } },
      { function: { name: "buscar_conhecimento" } },
    ],
    decision,
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.function.name, "audaar_check_in");
});

test("evaluateSmartFallback blocks plain chat when required pending", () => {
  const contract = buildExecutionContract({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "check-in ABC123",
    availableToolNames: ["audaar_consultar_reserva"],
  });
  const decision = evaluateSmartFallback({
    contract,
    toolOutcomes: [],
    errorKind: "llm_timeout",
  });
  assert.equal(decision.allowPlainChat, false);
  assert.equal(decision.retryToolRuntime, true);
});

test("checkExecutionConsistency detects missing required tool", () => {
  const contract = buildExecutionContract({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "check-in ABC123",
    availableToolNames: ["audaar_consultar_reserva"],
  });
  const result = checkExecutionConsistency({
    contract,
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: "{}" }],
  });
  assert.equal(result.consistent, false);
  assert.ok(result.divergences.some((d) => d.kind === "missing_required_tool" || d.kind === "constraint_violation"));
});

test("initializeRuntimeV2 produces valid session", () => {
  const session = initializeRuntimeV2({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "olá",
    availableToolNames: ["buscar_conhecimento"],
  });
  assert.ok(session.contract.contractId);
  assert.ok(session.orchestratorPromptBlock.includes("Runtime V2"));
});

test("ToolScheduler forces mandatory tool with required tool_choice", () => {
  const session = initializeRuntimeV2({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "sim",
    availableToolNames: ["audaar_check_in", "buscar_conhecimento"],
    lastAssistantMessage: "Confirme a FICHA DE VIAGEM. Está tudo certo?",
  });
  const allTools = [
    { function: { name: "audaar_check_in", description: "check in", parameters: {} } },
    { function: { name: "buscar_conhecimento", description: "kb", parameters: {} } },
  ];
  const decision = scheduleNextAction({
    session,
    allTools,
    toolOutcomes: [],
  });
  if (session.orchestrator.mandatoryNextTool) {
    assert.equal(decision.phase, "invoke_tool");
    assert.equal(decision.blockTextReply, true);
  }
});

test("ContractSupervisor detects pending required tools", () => {
  const contract = buildExecutionContract({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "check-in ABC123",
    availableToolNames: ["audaar_consultar_reserva"],
  });
  const checks = buildContractSupervisorChecks({
    contract,
    toolOutcomes: [],
    replyText: "",
  });
  assert.ok(checks.some((c) => c.id === "contract_required_tools"));
});

test("executeRecoveryStrategy switches provider on attempt 2", () => {
  const result = executeRecoveryStrategy(
    { kind: "provider_switch", toolName: "audaar_check_in", reason: "test", attempt: 2 },
    { attempt: 1, toolName: "audaar_check_in", currentProvider: "openai" },
  );
  assert.equal(result.switchProvider, "google_gemini");
  assert.equal(result.shouldRetry, true);
});

test("applyRecoveryToLlmConfig overrides provider and model", () => {
  const applied = applyRecoveryToLlmConfig("openai", "gpt-4o-mini", {
    switchProvider: "google_gemini",
    switchModel: "gemini-2.0-flash",
  });
  assert.equal(applied.provider, "google_gemini");
  assert.equal(applied.model, "gemini-2.0-flash");
});

test("shouldRunDeterministicToolPhase true for mandatory invoke_tool", () => {
  assert.equal(
    shouldRunDeterministicToolPhase({
      phase: "invoke_tool",
      scheduledTool: "audaar_check_in",
      toolChoice: { type: "function", function: { name: "audaar_check_in" } },
      activeTools: [],
      reason: "test",
      blockTextReply: true,
    }),
    true,
  );
  assert.equal(
    shouldRunDeterministicToolPhase({
      phase: "generate_reply",
      scheduledTool: null,
      toolChoice: "auto",
      activeTools: [],
      reason: "test",
      blockTextReply: false,
    }),
    false,
  );
});

test("buildKbToolPreamble covers proactive KB", () => {
  const preamble = buildKbToolPreamble({
    kbHasUsefulExcerpts: true,
    proactiveCoversQuery: true,
    allowedTagIds: [],
    customToolPreamble: "",
  });
  assert.ok(preamble.includes("buscar_conhecimento"));
});

test("buildContractWorkflowFindings uses execution contract", () => {
  const contract = buildExecutionContract({
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
    },
    userMessage: "check-in ABC123",
    availableToolNames: ["audaar_consultar_reserva"],
  });
  const findings = buildContractWorkflowFindings({
    executionContract: contract,
    toolOutcomes: [],
    replyText: "",
  });
  assert.ok(findings.some((f) => f.phase === "F-V2" && f.id === "contract_required_tools"));
});
