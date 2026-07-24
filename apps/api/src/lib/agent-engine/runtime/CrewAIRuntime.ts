import type { AgentRuntime } from "./AgentRuntime.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { OrchestratedRuntimeBase } from "./orchestrationHelpers.js";

/**
 * CrewAI Runtime — orquestração multi-papel (Planner → Worker → Manager).
 * Delega execução ao pipeline nativo OpenConduit; roles reflectem-se no trace.
 */
export class CrewAIRuntime extends OrchestratedRuntimeBase implements AgentRuntime {
  readonly kind = "crewai" as const;

  constructor(executor: NativeAgentExecutor) {
    super("crewai", executor, {
      graphHistory: [
        "crew_plan",
        "load_memory",
        "crew_delegate",
        "execute_tool",
        "validate_result",
        "crew_manager",
        "supervisor",
        "update_memory",
        "respond",
      ],
      preMemory: [
        async (state) => {
          state.traceBuilder.startNode("crew_plan", "CrewAI — Planner");
          state.traceBuilder.endNode(
            "crew_plan",
            "ok",
            `Tarefa: ${(state.input.message.body ?? "").slice(0, 120)}`,
          );
        },
        async (state) => {
          state.traceBuilder.startNode("crew_delegate", "CrewAI — Delegar ao Worker");
          state.traceBuilder.endNode("crew_delegate", "ok", "Worker nativo OpenConduit");
        },
      ],
      postExecute: async (state) => {
        state.traceBuilder.startNode("crew_manager", "CrewAI — Manager review");
        const status = state.supervisorApproved ? "ok" : "warn";
        state.traceBuilder.endNode(
          "crew_manager",
          status,
          state.supervisorApproved ? "Resposta aprovada pelo manager" : "Manager pediu revisão",
        );
        if (!state.supervisorApproved && state.retryCount < 1) return "retry";
        return "continue";
      },
      maxRetries: 1,
    });
  }
}
