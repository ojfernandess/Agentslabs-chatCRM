import type { EilCategoryId } from "./eilCategories.js";

export type FactValue = string | number | boolean | null;

export type EilPredicateDraft = {
  fact: string;
  op: string;
  value?: FactValue;
};

export function coerceFactValue(value: unknown): FactValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export type AgentEilPolicyDraft = {
  id: string;
  action?: string;
  requires?: EilPredicateDraft[];
  forbids?: EilPredicateDraft[];
  blockWhenUnmet?: boolean;
  name?: string;
  description?: string;
  instruction?: string;
  active?: boolean;
  onUnknown?: "fetch" | "ask" | "block" | "ignore";
  onViolation?: "block" | "guide" | "escalate" | "alert" | "warn";
  idManuallyEdited?: boolean;
};

export type EilCustomActionDef = {
  id: string;
  label: string;
  description?: string;
  enabled?: boolean;
  /** Aliases opcionais para detecção textual (metadata de editor). */
  detectionAliases?: string[];
};

export type AgentEilConfigDraft = {
  enabled?: boolean;
  /** Categoria EIL (preset de UI — não altera runtime). */
  category?: EilCategoryId;
  customActions?: EilCustomActionDef[];
  policies?: AgentEilPolicyDraft[];
};
