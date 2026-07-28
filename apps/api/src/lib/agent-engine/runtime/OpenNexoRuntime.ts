import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRuntimeExecuteInput, AgentRuntimeExecuteResult } from "../types.js";
import { OrchestratedRuntimeBase } from "./orchestrationHelpers.js";

export type NativeAgentKbMeta = {
  hasUsefulExcerpts: boolean;
  coversQuery: boolean;
};

export type NativeAgentExecutorResult = {
  reply: string;
  toolOutcomes?: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>;
  kbMeta?: NativeAgentKbMeta;
  llmSupervisorApproved?: boolean | null;
  llmSupervisorSummary?: string;
};

export type NativeAgentExecutor = (
  input: AgentRuntimeExecuteInput,
) => Promise<NativeAgentExecutorResult>;

/**
 * Runtime padrão — delega ao pipeline nativo com supervisor/retry + Runtime V2.
 * Paridade com LangGraph (contratos, orchestrator, contract supervisor).
 */
export class OpenNexoRuntime extends OrchestratedRuntimeBase implements AgentRuntime {
  readonly kind = "openconduit" as const;

  constructor(executor: NativeAgentExecutor) {
    super("openconduit", executor, {
      graphHistory: [
        "load_memory",
        "select_tool",
        "execute_tool",
        "validate_result",
        "supervisor",
        "update_memory",
        "respond",
      ],
      maxRetries: 2,
    });
  }

  /** Retrocompat — OrchestratedRuntimeBase.execute devolve AgentRuntimeExecuteResult. */
  override async execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult> {
    return super.execute(input);
  }
}
