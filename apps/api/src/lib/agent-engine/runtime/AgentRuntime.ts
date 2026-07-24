import type {
  AgentRuntimeExecuteInput,
  AgentRuntimeExecuteResult,
  AgentRuntimeState,
} from "../types.js";

/**
 * Contrato único para todos os motores (OpenNexo, LangGraph, CrewAI, …).
 * O resto do CRM depende apenas desta interface — Adapter Pattern.
 */
export interface AgentRuntime {
  readonly kind: AgentRuntimeExecuteInput["engineConfig"]["runtime"];

  execute(input: AgentRuntimeExecuteInput): Promise<AgentRuntimeExecuteResult>;

  pause?(): Promise<void>;
  resume?(): Promise<void>;
  stop?(): Promise<void>;
  interrupt?(): Promise<void>;
  continue?(): Promise<void>;

  callTool?(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  loadMemory?(conversationId: string): Promise<Record<string, unknown>>;
  saveMemory?(conversationId: string, data: Record<string, unknown>): Promise<void>;
  validate?(): Promise<{ ok: boolean; errors: string[] }>;
  getState?(): AgentRuntimeState;
}
