import { toolsMatchAlias } from "../validators/turnPolicyParser.js";

/** Chave genérica em flowSlots para tools satisfeitas na conversa (CSV). */
export const SESSION_SATISFIED_TOOLS_KEY = "__satisfiedToolNames";

export function readSessionSatisfiedToolNames(
  flowSlots?: Record<string, string | number | boolean> | null,
): string[] {
  if (!flowSlots) return [];
  const raw = flowSlots[SESSION_SATISFIED_TOOLS_KEY];
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function appendSessionSatisfiedToolName(
  flowSlots: Record<string, string | number | boolean>,
  toolName: string,
): Record<string, string | number | boolean> {
  const name = toolName.trim();
  if (!name) return flowSlots;
  const prev = readSessionSatisfiedToolNames(flowSlots);
  if (prev.some((t) => toolsMatchAlias(t, name))) return flowSlots;
  return {
    ...flowSlots,
    [SESSION_SATISFIED_TOOLS_KEY]: [...prev, name].join(","),
  };
}

export function priorToolOutcomesFromSession(
  flowSlots?: Record<string, string | number | boolean> | null,
): Array<{ name: string; ok: boolean }> {
  return readSessionSatisfiedToolNames(flowSlots).map((name) => ({ name, ok: true }));
}

/** Acrescenta tools OK ao CSV de sessão (genérico). Falhas (`ok: false`) nunca entram. */
export function mergeSatisfiedToolsFromOutcomes(
  flowSlots: Record<string, string | number | boolean>,
  outcomes: Array<{ name: string; ok?: boolean }>,
): Record<string, string | number | boolean> {
  let slots = flowSlots;
  for (const o of outcomes) {
    if (o.ok === false) continue;
    slots = appendSessionSatisfiedToolName(slots, o.name);
  }
  return slots;
}

/** Persiste flowSlots mesclando tools OK da sessão + facts EIL (sem sobrescrever __satisfiedToolNames). */
export function buildPersistedFlowSlots(opts: {
  baseFlowSlots?: Record<string, string | number | boolean> | null;
  toolOutcomes?: Array<{ name: string; ok?: boolean }>;
  eilFacts?: Record<string, { value?: unknown }>;
}): Record<string, string | number | boolean> {
  let slots: Record<string, string | number | boolean> = { ...(opts.baseFlowSlots ?? {}) };
  slots = mergeSatisfiedToolsFromOutcomes(slots, opts.toolOutcomes ?? []);
  if (opts.eilFacts) {
    for (const [k, f] of Object.entries(opts.eilFacts)) {
      if (k === SESSION_SATISFIED_TOOLS_KEY) continue;
      if (f.value !== null && f.value !== undefined) {
        slots[k] = f.value as string | number | boolean;
      }
    }
  }
  return slots;
}
