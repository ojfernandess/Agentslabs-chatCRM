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
