/**
 * Guardas globais do runtime para fluxos reference → Embratur → check-in.
 * Aplica-se a qualquer agente/playbook com tools de referência + conclusão.
 */

import { hasCompleteEmbraturFields, listMissingEmbraturFieldKeys } from "./embraturReferenceResolver.js";

export const EMBRATUR_RESOLUTION_PENDING_SLOT = "__embraturResolutionPending";

/** Tool de conclusão de check-in (exclui upload/consulta). */
export function isCheckInCompletionToolName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!/check[_-]?in|checkin/.test(n)) return false;
  if (/upload|selfie|documento|document|photo|foto|consultar|reserva|disponibilidade/.test(n)) {
    return false;
  }
  return true;
}

export function isEmbraturReferenceToolName(name: string): boolean {
  return /embratur[-_]?reference/i.test(name.trim());
}

/** Há ficha ou fase pós-gate que exige IDs Embratur antes do check-in. */
export function flowRequiresEmbraturResolution(
  flowSlots?: Record<string, unknown> | null,
): boolean {
  if (!flowSlots) return false;
  if (flowSlots.__completionReady === true || flowSlots.__completionReady === "true") return true;
  if (flowSlots[EMBRATUR_RESOLUTION_PENDING_SLOT] === true) return true;
  if (flowSlots[EMBRATUR_RESOLUTION_PENDING_SLOT] === "true") return true;
  const form = flowSlots.__travelFormMessage;
  return typeof form === "string" && form.trim().length > 0;
}

/** Omitir tools de check-in do catálogo LLM até Embratur completo. */
export function shouldBlockCheckInUntilEmbraturResolved(
  flowSlots?: Record<string, unknown> | null,
): boolean {
  if (!flowRequiresEmbraturResolution(flowSlots)) return false;
  return !hasCompleteEmbraturFields((flowSlots ?? {}) as Record<string, unknown>);
}

export function buildEmbraturIncompleteToolError(
  flowSlots?: Record<string, unknown> | null,
): string {
  const missing = listMissingEmbraturFieldKeys((flowSlots ?? {}) as Record<string, unknown>);
  return JSON.stringify({
    ok: false,
    validationError: true,
    error: "embratur_incomplete",
    missingFields: missing,
    message:
      "Campos Embratur (FNRH) incompletos. O runtime deve resolver IDs via embratur-reference " +
      "(domínios embratur_cb_country, embratur_cb_city, etc.) antes de concluir o check-in. " +
      `Campos em falta: ${missing.join(", ")}.`,
  });
}
