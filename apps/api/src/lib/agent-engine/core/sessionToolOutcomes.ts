import { CONFIRMATION_USER_MSG_RE } from "../validators/playbookRuntimePolicy.js";
import {
  messageLooksLikePostGateFormData,
  SESSION_LAST_ASSISTANT_PREVIEW_KEY,
} from "./confirmationTurnGuards.js";
import { extractEmbraturSlotsFromTravelForm } from "../checkin/embraturTravelForm.js";
import { readEmbraturReferenceCatalogFromFlowSlots } from "../checkin/embraturReferenceCatalog.js";
import { hasCompleteEmbraturFields } from "../checkin/embraturReferenceResolver.js";
import { EMBRATUR_RESOLUTION_PENDING_SLOT } from "../checkin/embraturRuntimeGuards.js";

/** Chave genérica em flowSlots para tools satisfeitas na conversa (CSV). */
export const SESSION_SATISFIED_TOOLS_KEY = "__satisfiedToolNames";

/** Match local (evita ciclo com turnPolicyParser). */
function toolsMatchAlias(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/-/g, "_");
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Após tool de gate (pré-requisito de confirmação) — falta recolha de dados
 * antes de auto-exigir tools de conclusão no próximo "sim".
 */
export const SESSION_AWAITING_POST_GATE_DATA_KEY = "__awaitingPostGateData";

/** Utilizador já enviou dados após o gate — "sim" pode exigir conclusão. */
export const SESSION_COMPLETION_READY_KEY = "__completionReady";

/**
 * Tool de conclusão OK neste turno — próximo turno é Passo 8 / pós-conclusão
 * (não reabrir exclusive de gate nem reexigir check-in).
 */
export const SESSION_POST_COMPLETION_PENDING_KEY = "__postCompletionPending";

export { SESSION_LAST_ASSISTANT_PREVIEW_KEY };

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

function slotFlagTrue(
  flowSlots: Record<string, string | number | boolean> | null | undefined,
  key: string,
): boolean {
  if (!flowSlots) return false;
  const v = flowSlots[key];
  return v === true || v === "true" || v === 1;
}

export function isAwaitingPostGateData(
  flowSlots?: Record<string, string | number | boolean> | null,
): boolean {
  return slotFlagTrue(flowSlots, SESSION_AWAITING_POST_GATE_DATA_KEY);
}

export function isCompletionReady(
  flowSlots?: Record<string, string | number | boolean> | null,
): boolean {
  return slotFlagTrue(flowSlots, SESSION_COMPLETION_READY_KEY);
}

export function isPostCompletionPending(
  flowSlots?: Record<string, string | number | boolean> | null,
): boolean {
  return slotFlagTrue(flowSlots, SESSION_POST_COMPLETION_PENDING_KEY);
}

/**
 * Máquina de fase genérica (multi-segmento):
 * gate tool OK → aguarda dados de formulário → ready → conclusão OK → limpa.
 *
 * Não arma `completionReady` com CPF/nacionalidade/localizador — só com bloco
 * de formulário (evita saltar para tool de conclusão no espelho do titular).
 */
export function applyConfirmationPhaseTransitions(opts: {
  baseFlowSlots?: Record<string, string | number | boolean> | null;
  toolOutcomes?: Array<{ name: string; ok?: boolean }>;
  confirmationPrerequisiteTools?: string[];
  completionToolHints?: string[];
  userMessage?: string;
  /** Preview da resposta do agente neste turno (persistido para o próximo). */
  lastAssistantPreview?: string;
  /** Turno sintético pós-conclusão (Passo 8) — limpa a flag pending. */
  clearPostCompletionPending?: boolean;
}): Record<string, string | number | boolean> {
  const slots: Record<string, string | number | boolean> = {
    ...(opts.baseFlowSlots ?? {}),
  };
  const prereqs = opts.confirmationPrerequisiteTools ?? [];
  const completion = opts.completionToolHints ?? [];
  const okOutcomes = (opts.toolOutcomes ?? []).filter((t) => t.ok !== false);
  const userMessage = (opts.userMessage ?? "").trim();

  const gateJustOk = okOutcomes.some((o) =>
    prereqs.some((p) => toolsMatchAlias(o.name, p)),
  );
  if (gateJustOk) {
    slots[SESSION_AWAITING_POST_GATE_DATA_KEY] = true;
    slots[SESSION_COMPLETION_READY_KEY] = false;
    slots[SESSION_POST_COMPLETION_PENDING_KEY] = false;
  }

  // Só formulário pós-gate libera conclusão — não CPF / nacionalidade / localizador.
  // Também aceita ficha quando o agente pediu o template dos 6 sem ter marcado awaiting
  // (ex.: LLM saltou `embratur-reference` mas já pediu Motivo/Transporte).
  const assistantAskedEmbraturSix =
    typeof opts.lastAssistantPreview === "string" &&
    /\b(motivo(?:\s+da\s+viagem)?|meio\s+de\s+transporte|template\s+dos\s*6|ficha\s+de\s+viagem)\b/i.test(
      opts.lastAssistantPreview,
    );
  if (
    userMessage &&
    !CONFIRMATION_USER_MSG_RE.test(userMessage) &&
    messageLooksLikePostGateFormData(userMessage) &&
    (slotFlagTrue(slots, SESSION_AWAITING_POST_GATE_DATA_KEY) || assistantAskedEmbraturSix)
  ) {
    slots[SESSION_AWAITING_POST_GATE_DATA_KEY] = false;
    slots[SESSION_COMPLETION_READY_KEY] = false;
    // Persistir ficha; IDs só após match na embratur-reference (runtime resolve depois).
    const catalog = readEmbraturReferenceCatalogFromFlowSlots(slots);
    Object.assign(slots, extractEmbraturSlotsFromTravelForm(userMessage, catalog));
    slots.__travelFormMessage = userMessage.trim().slice(0, 1500);
    if (hasCompleteEmbraturFields(slots as Record<string, unknown>)) {
      slots[SESSION_COMPLETION_READY_KEY] = true;
      slots[EMBRATUR_RESOLUTION_PENDING_SLOT] = false;
    } else {
      slots[EMBRATUR_RESOLUTION_PENDING_SLOT] = true;
    }
  }

  const completionJustOk = okOutcomes.some((o) =>
    completion.some((h) => toolsMatchAlias(o.name, h)),
  );
  if (completionJustOk) {
    slots[SESSION_AWAITING_POST_GATE_DATA_KEY] = false;
    slots[SESSION_COMPLETION_READY_KEY] = false;
    slots[SESSION_POST_COMPLETION_PENDING_KEY] = true;
  }

  if (opts.clearPostCompletionPending) {
    slots[SESSION_POST_COMPLETION_PENDING_KEY] = false;
  }

  const preview = (opts.lastAssistantPreview ?? "").trim();
  if (preview) {
    slots[SESSION_LAST_ASSISTANT_PREVIEW_KEY] = preview.slice(0, 800);
  }

  return slots;
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
