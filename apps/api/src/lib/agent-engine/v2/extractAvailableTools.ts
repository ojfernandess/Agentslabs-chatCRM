/**
 * Extrai nomes de tools disponíveis a partir do behaviorConfig (genérico).
 */

import { KNOWN_NATIVE_TOOL_NAMES } from "../validators/requiredToolNamesParser.js";

const NATIVE_FLAG_MAP: Record<string, string> = {
  knowledge_search: "buscar_conhecimento",
  list_teams: "listar_equipas",
  transfer_to_team: "transfer_to_team",
  call_human: "call_human",
  set_conversation_status: "set_conversation_status",
  assign_contact_tags: "listar_etiquetas",
};

/** Lista tools nativas + HTTP conectadas declaradas no behavior. */
export function extractAvailableToolNamesFromBehavior(
  behaviorConfig: Record<string, unknown> | null | undefined,
): string[] {
  const names = new Set<string>();
  if (!behaviorConfig || typeof behaviorConfig !== "object") return [];

  const nativeTools = behaviorConfig.nativeTools;
  if (nativeTools && typeof nativeTools === "object") {
    for (const [flag, toolName] of Object.entries(NATIVE_FLAG_MAP)) {
      if ((nativeTools as Record<string, unknown>)[flag] === true) {
        names.add(toolName);
      }
    }
    // atribuir_etiquetas partilha flag assign_contact_tags
    if ((nativeTools as Record<string, unknown>).assign_contact_tags === true) {
      names.add("atribuir_etiquetas");
    }
  }

  const connected = behaviorConfig.connectedTools;
  if (Array.isArray(connected)) {
    for (const entry of connected) {
      if (!entry || typeof entry !== "object") continue;
      const name = (entry as { name?: string }).name;
      if (typeof name === "string" && name.trim()) names.add(name.trim());
    }
  }

  // Fallback: todas as nativas conhecidas se nativeTools ausente
  if (names.size === 0 && !nativeTools) {
    for (const n of KNOWN_NATIVE_TOOL_NAMES) names.add(n);
  }

  return [...names];
}
