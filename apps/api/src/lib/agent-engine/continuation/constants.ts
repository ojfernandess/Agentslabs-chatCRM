/** Prefixo interno em mensagens INBOUND sintéticas de continuação proactiva. */
export const AGENT_CONTINUATION_MESSAGE_PREFIX = "[__oc_continuation__:";

export function buildContinuationSyntheticBody(ruleId: string, turnHint: string): string {
  const id = ruleId.trim().slice(0, 120);
  const hint = turnHint.trim().slice(0, 4000);
  return `${AGENT_CONTINUATION_MESSAGE_PREFIX}${id}]\n${hint}`;
}

export function parseContinuationSyntheticBody(
  body: string,
): { ruleId: string; turnHint: string } | null {
  const raw = body.trim();
  if (!raw.startsWith(AGENT_CONTINUATION_MESSAGE_PREFIX)) return null;
  const rest = raw.slice(AGENT_CONTINUATION_MESSAGE_PREFIX.length);
  const close = rest.indexOf("]");
  if (close < 1) return null;
  const ruleId = rest.slice(0, close).trim();
  const turnHint = rest.slice(close + 1).trim();
  if (!ruleId || !turnHint) return null;
  return { ruleId, turnHint };
}

export function isContinuationSyntheticMessage(body: string | null | undefined): boolean {
  return Boolean(body?.trim().startsWith(AGENT_CONTINUATION_MESSAGE_PREFIX));
}
