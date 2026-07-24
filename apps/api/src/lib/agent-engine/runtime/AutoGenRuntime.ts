import type { AgentRuntime } from "./AgentRuntime.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { OrchestratedRuntimeBase } from "./orchestrationHelpers.js";
import { buildSupervisorTrace, shouldRetryAfterSupervisor } from "../supervisor/AgentSupervisorService.js";

/**
 * AutoGen Runtime — loop conversacional agente↔supervisor com retries controlados.
 */
export class AutoGenRuntime extends OrchestratedRuntimeBase implements AgentRuntime {
  readonly kind = "autogen" as const;

  constructor(executor: NativeAgentExecutor) {
    super("autogen", executor, {
      graphHistory: [
        "autogen_session",
        "load_memory",
        "autogen_agent",
        "execute_tool",
        "validate_result",
        "autogen_critic",
        "supervisor",
        "update_memory",
        "respond",
      ],
      preMemory: [
        async (state) => {
          state.traceBuilder.startNode("autogen_session", "AutoGen — Sessão multi-agente");
          state.traceBuilder.endNode("autogen_session", "ok", "Agent + Critic loop");
        },
      ],
      postExecute: async (state) => {
        state.traceBuilder.startNode("autogen_critic", "AutoGen — Critic");
        const supTrace = buildSupervisorTrace({
          userMessage: state.input.message.body ?? "",
          replyText: state.reply,
          toolSummary: state.toolOutcomes.map((t) => `${t.name}:${t.ok}`).join(", "),
          kbHasUsefulExcerpts: false,
          successfulToolCount: state.toolOutcomes.filter((t) => t.ok).length,
          totalToolCount: state.toolOutcomes.length,
          strictMode: state.input.engineConfig.strictMode,
        });
        state.traceBuilder.endNode(
          "autogen_critic",
          supTrace.approved ? "ok" : "warn",
          supTrace.summary,
        );
        state.supervisorApproved = supTrace.approved;
        if (
          shouldRetryAfterSupervisor(
            supTrace,
            state.input.engineConfig.strictMode,
            state.retryCount,
          )
        ) {
          return "retry";
        }
        return "continue";
      },
      maxRetries: 2,
    });
  }
}
