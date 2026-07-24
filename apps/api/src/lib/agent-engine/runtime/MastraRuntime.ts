import type { AgentRuntime } from "./AgentRuntime.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { OrchestratedRuntimeBase } from "./orchestrationHelpers.js";
import { evaluateStrictModeGate } from "../validators/StrictModeGate.js";

/**
 * Mastra Runtime — workflow declarativo (compose → run → audit).
 */
export class MastraRuntime extends OrchestratedRuntimeBase implements AgentRuntime {
  readonly kind = "mastra" as const;

  constructor(executor: NativeAgentExecutor) {
    super("mastra", executor, {
      graphHistory: [
        "mastra_compose",
        "load_memory",
        "mastra_execute",
        "execute_tool",
        "validate_result",
        "mastra_audit",
        "supervisor",
        "update_memory",
        "respond",
      ],
      preMemory: [
        async (state) => {
          state.traceBuilder.startNode("mastra_compose", "Mastra — Compor workflow");
          const steps = ["load_memory", "execute_tool", "validate", "audit", "respond"];
          state.traceBuilder.endNode("mastra_compose", "ok", steps.join(" → "));
        },
        async (state) => {
          state.traceBuilder.startNode("mastra_execute", "Mastra — Executar workflow");
          state.traceBuilder.endNode("mastra_execute", "ok", "Step: agent + tools");
        },
      ],
      postMemory: [
        async (state) => {
          if (!state.input.engineConfig.strictMode || !state.reply.trim()) return;
          state.traceBuilder.startNode("mastra_audit", "Mastra — Audit trail");
          const audit = evaluateStrictModeGate({
            strictMode: true,
            replyText: state.reply,
            userMessage: state.input.message.body ?? "",
            toolOutcomes: state.toolOutcomes,
          });
          state.traceBuilder.endNode(
            "mastra_audit",
            audit.blockSend ? "error" : "ok",
            `Confiança ${audit.confidence}%`,
          );
          if (audit.blockSend) {
            state.input.executionLog?.error(
              { id: "strict_mode", name: "Modo estrito" },
              `Mastra audit blocked — ${audit.confidence}%`,
              { output: { confidence: audit.confidence, reasons: audit.reasons.slice(0, 5) } },
            );
            state.reply = "";
          }
        },
      ],
      maxRetries: 1,
    });
  }
}
