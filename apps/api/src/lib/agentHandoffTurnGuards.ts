/**
 * Guards contra transferências/handoffs duplicados quando vários turnos do agente
 * correm em paralelo (rajada de inbound + fila por conversa).
 */

/** Conversa já estava em handoff humano quando o turno começou — descartar sem LLM/outbound. */
export function shouldDiscardStaleAgentTurn(handoffAtTurnStart: boolean): boolean {
  return handoffAtTurnStart;
}

/** Após a geração: só enviar mensagem de escalonamento se este turno invocou call_human. */
export function shouldDeliverEscalationTransferAfterGeneration(
  handoffAtTurnStart: boolean,
  handoffAfterGeneration: boolean,
  callHumanInvokedThisTurn: boolean,
): boolean {
  if (!handoffAfterGeneration) return false;
  if (handoffAtTurnStart) return false;
  return callHumanInvokedThisTurn;
}

/** Evita call_human automático duplicado (limite de interações ou gate pré-LLM). */
export function shouldInvokeAutomaticHandoff(alreadyAwaitingHuman: boolean): boolean {
  return !alreadyAwaitingHuman;
}
