import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";

/** Quando `AGENT_KB_DEBUG=true`, emite logs estruturados para diagnosticar RAG / buscar_conhecimento. */
export function isAgentKbDebugEnabled(): boolean {
  return config.agentKbDebug;
}

export function logAgentKbDebug(log: FastifyBaseLogger, payload: Record<string, unknown>): void {
  if (!config.agentKbDebug) return;
  // Usar warn para garantir que apareça em deployments com level > info.
  log.warn({ agentKbDebug: payload }, "agent_kb_debug");
}
