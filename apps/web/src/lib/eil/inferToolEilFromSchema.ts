import { EIL_FACT_CATALOG } from "./catalog.js";
import type { ToolEilConfigDraft } from "./toolConfig.js";
import { TOOL_EIL_NAME_PRESETS } from "./toolEilPresets.js";

const KNOWN_FACT_KEYS = new Set(EIL_FACT_CATALOG.map((f) => f.key));

/** Parâmetros genéricos de invocação — não viram requiresFacts automaticamente. */
const GENERIC_PARAM_EXCLUDES = new Set([
  "query",
  "message",
  "title",
  "description",
  "start",
  "end",
  "conversationid",
  "teamid",
  "assignedtoid",
  "calendar_name",
  "status",
  "mode",
  "approvecheckin",
  "senttoreception",
  "validatedcheckin",
]);

const PARAM_TO_FACT_ALIASES: Record<string, string> = {
  reservationidorlocalizer: "localizadorOuReservationId",
  localizador: "localizadorOuReservationId",
  localizer: "localizadorOuReservationId",
  reference: "localizadorOuReservationId",
  booking_reference: "localizadorOuReservationId",
  reservation_code: "localizadorOuReservationId",
  codigo: "localizadorOuReservationId",
  cpf: "documentNumber",
  document: "documentNumber",
  guestname: "name",
  guestemail: "email",
  phone: "mobilePhoneNumber",
};

export type SchemaPropertyInfo = {
  name: string;
  required: boolean;
  type?: string;
  description?: string;
};

export function parseParametersSchema(schema: Record<string, unknown>): SchemaPropertyInfo[] {
  const root =
    schema.type === "object" && schema.properties && typeof schema.properties === "object"
      ? schema
      : schema.properties && typeof schema.properties === "object"
        ? schema
        : null;
  if (!root) return [];

  const properties = root.properties as Record<string, Record<string, unknown>>;
  const requiredSet = new Set(
    Array.isArray(root.required) ? root.required.filter((x): x is string => typeof x === "string") : [],
  );

  return Object.entries(properties).map(([name, def]) => ({
    name,
    required: requiredSet.has(name),
    type: typeof def.type === "string" ? def.type : undefined,
    description: typeof def.description === "string" ? def.description : undefined,
  }));
}

function normalizeParamKey(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const alias = PARAM_TO_FACT_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (KNOWN_FACT_KEYS.has(trimmed)) return trimmed;
  return trimmed;
}

function isUsefulRequiresFact(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name.trim())) return false;
  if (GENERIC_PARAM_EXCLUDES.has(lower)) return false;
  return true;
}

function inferRequiresFactsFromParams(properties: SchemaPropertyInfo[]): string[] {
  const out = new Set<string>();
  for (const prop of properties) {
    if (!prop.required) continue;
    const fact = normalizeParamKey(prop.name);
    if (isUsefulRequiresFact(fact)) out.add(fact);
  }
  return [...out];
}

function inferCapabilityFromName(toolName: string): string {
  const n = toolName.trim().toLowerCase();
  if (/consultar|buscar|lookup|get_|fetch_/.test(n)) {
    if (/reserva|reservation|booking/.test(n)) return "lookup_reservation";
    if (/guest|hospede|cliente|customer/.test(n)) return "lookup_main_guest";
    if (/conhecimento|knowledge|kb/.test(n)) return "knowledge";
    return "lookup";
  }
  if (/check_in|checkin|check-in/.test(n)) return "complete_checkin";
  if (/agendar|schedule|calendar/.test(n)) return "scheduling";
  if (/pagamento|payment|pix|cobranca/.test(n)) return "payment";
  return n.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

function presetForToolName(toolName: string): ToolEilConfigDraft | null {
  for (const preset of TOOL_EIL_NAME_PRESETS) {
    if (preset.pattern.test(toolName)) return structuredClone(preset.eil);
  }
  return null;
}

function unionStrings(...lists: Array<string[] | undefined>): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    for (const item of list ?? []) {
      const trimmed = item.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return [...out];
}

function mergeFactPaths(...maps: Array<Record<string, string> | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [k, v] of Object.entries(map)) {
      const key = k.trim();
      const path = v.trim();
      if (key && path) out[key] = path;
    }
  }
  return out;
}

export type InferToolEilResult = {
  draft: ToolEilConfigDraft;
  summary: {
    fromPreset: boolean;
    paramProperties: number;
    requiresFromParams: number;
  };
};

/**
 * Infere config.eil a partir do nome da ferramenta e parametersSchema.
 * Não altera runtime — apenas gera metadados declarativos para o editor.
 */
export function inferToolEilFromSchema(input: {
  toolName: string;
  parametersSchema: Record<string, unknown>;
  existing?: ToolEilConfigDraft;
}): InferToolEilResult {
  const properties = parseParametersSchema(input.parametersSchema);
  const preset = presetForToolName(input.toolName);
  const requiresFromParams = inferRequiresFactsFromParams(properties);

  const inferred: ToolEilConfigDraft = preset
    ? { ...preset }
    : {
        capabilities: [inferCapabilityFromName(input.toolName)],
      };

  if (!preset && requiresFromParams.length > 0) {
    inferred.requiresFacts = requiresFromParams;
  } else if (preset && requiresFromParams.length > 0) {
    inferred.requiresFacts = unionStrings(inferred.requiresFacts, requiresFromParams);
  }

  const existing = input.existing ?? {};
  const draft: ToolEilConfigDraft = {
    produces: unionStrings(existing.produces, inferred.produces),
    requiresFacts: unionStrings(existing.requiresFacts, inferred.requiresFacts),
    capabilities: unionStrings(existing.capabilities, inferred.capabilities),
    factPaths: mergeFactPaths(existing.factPaths, inferred.factPaths),
  };

  // factPaths padrão: chave → chave (FactsEngine usa fallback path = key)
  if (draft.produces?.length) {
    const paths = { ...(draft.factPaths ?? {}) };
    for (const fact of draft.produces) {
      if (!paths[fact]) paths[fact] = fact;
    }
    draft.factPaths = paths;
  }

  return {
    draft,
    summary: {
      fromPreset: Boolean(preset),
      paramProperties: properties.length,
      requiresFromParams: requiresFromParams.length,
    },
  };
}

/** Nomes de parâmetros úteis como sugestões de facts no editor. */
export function parameterFactSuggestions(parametersSchema: Record<string, unknown>): string[] {
  return parseParametersSchema(parametersSchema)
    .map((p) => normalizeParamKey(p.name))
    .filter((name) => isUsefulRequiresFact(name) || KNOWN_FACT_KEYS.has(name));
}
