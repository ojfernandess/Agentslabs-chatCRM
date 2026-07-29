import type { AgentEngineConfig, AgentRuntimeKind } from "../types.js";

/**
 * Contexto estável do turno — IDs e flags; não contém plano nem contrato mutáveis.
 */
export type ExecutionContext = {
  version: 1;
  turnId: string;
  organizationId: string;
  botId: string;
  conversationId: string;
  messageId: string;
  userMessage: string;
  runtime: AgentRuntimeKind;
  engineConfig: AgentEngineConfig;
  availableToolNames: string[];
  startedAt: string;
};

export type BeginExecutionContextOpts = {
  turnId: string;
  organizationId: string;
  botId: string;
  conversationId: string;
  messageId: string;
  userMessage: string;
  runtime: AgentRuntimeKind;
  engineConfig: AgentEngineConfig;
  availableToolNames?: string[];
};

export function createExecutionContext(opts: BeginExecutionContextOpts): ExecutionContext {
  return {
    version: 1,
    turnId: opts.turnId,
    organizationId: opts.organizationId,
    botId: opts.botId,
    conversationId: opts.conversationId,
    messageId: opts.messageId,
    userMessage: (opts.userMessage ?? "").trim(),
    runtime: opts.runtime,
    engineConfig: opts.engineConfig,
    availableToolNames: opts.availableToolNames ?? [],
    startedAt: new Date().toISOString(),
  };
}
