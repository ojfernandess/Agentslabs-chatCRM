/**
 * Fase 4 — Resolução genérica de argumentos a partir de schema/EIL metadata.
 * Sem imports de domínio (checkin/) — perfis por capability são dados declarativos.
 */
import type { TurnContext } from "../core/types.js";
import { findCapabilityNode } from "../eil/CapabilityGraph.js";
import type { CapabilityGraph, ToolEilConfig } from "../eil/types.js";

/** Perfil declarativo por capability — merge com config.eil da tool. */
const CAPABILITY_ARG_PROFILES: Record<string, Partial<ToolEilConfig>> = {
  knowledge: {
    messageArg: "query",
  },
  lookup: {
    argAliases: {
      reservationIdOrLocalizer: [
        "localizadorOuReservationId",
        "localizador",
        "localizer",
        "uid",
        "reference",
        "reservationId",
        "reservation_code",
        "booking_reference",
        "codigo",
      ],
      localizadorOuReservationId: [
        "reservationIdOrLocalizer",
        "localizador",
        "localizer",
        "uid",
        "reference",
        "reservationId",
      ],
      localizador: ["localizadorOuReservationId", "reservationIdOrLocalizer", "reference"],
      localizer: ["localizador", "localizadorOuReservationId"],
      reference: ["localizador", "reservationIdOrLocalizer"],
      reservationId: ["reservationIdOrLocalizer"],
      booking_reference: ["reference", "localizador"],
      reservation_code: ["codigo", "reference"],
      codigo: ["reference"],
    },
    entityArgMap: {
      referenceCode: [
        "reservationIdOrLocalizer",
        "localizadorOuReservationId",
        "reference",
        "localizador",
        "localizer",
        "booking_reference",
        "reservation_code",
        "codigo",
        "reservationId",
      ],
      documentNumber: ["cpf", "document", "documentNumber"],
    },
  },
  checkin: {
    argDefaults: {
      mode: "digital",
      approveCheckin: true,
      sentToReception: true,
      validatedCheckin: true,
    },
    argAliases: {
      reservationIdOrLocalizer: [
        "localizadorOuReservationId",
        "localizador",
        "localizer",
        "uid",
        "reference",
        "reservationId",
      ],
      localizadorOuReservationId: [
        "reservationIdOrLocalizer",
        "localizador",
        "localizer",
        "uid",
        "reference",
        "reservationId",
      ],
    },
    nestedGroups: [
      {
        target: "mainGuest",
        fieldMap: {
          name: ["name", "guestName", "mainGuestName", "fullName"],
          email: ["email", "guestEmail"],
          documentNumber: ["documentNumber", "cpf", "document"],
          documentType: ["documentType", "docType"],
          rg: ["rg", "rgNumber"],
          expeditor: ["expeditor", "rgExpeditor", "orgaoEmissor"],
          mobilePhoneNumber: ["mobilePhoneNumber", "phone"],
          birthDate: ["birthDate"],
          gender: ["gender"],
          profession: ["profession"],
          citizenship: ["citizenship", "nationality"],
          zipCode: ["zipCode", "postalCode"],
          country: ["country"],
          state: ["state"],
          city: ["city"],
          street: ["street", "address"],
          number: ["number", "addressNumber"],
          neighborhood: ["neighborhood"],
          profilePhotoUrl: ["profilePhotoUrl"],
          documentPhotoUrl: ["documentPhotoUrl"],
        },
      },
    ],
    entityArgMap: {
      documentNumber: ["cpf", "document", "documentNumber"],
    },
  },
};

const REFERENCE_CODE_RE = /\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,12}\b/i;

const TOOL_MESSAGE_ARGS: Record<string, string> = {
  buscar_conhecimento: "query",
};

/** Hints explícitos quando config.eil.capabilities não está preenchido. */
const TOOL_CAPABILITY_HINTS: Record<string, string[]> = {
  audaar_consultar_reserva: ["lookup"],
  consultar_reserva: ["lookup"],
  audaar_check_in: ["checkin"],
};

function mergeEilProfiles(
  toolEil: ToolEilConfig,
  capabilities: string[],
  toolName: string,
): ToolEilConfig {
  const hinted = TOOL_CAPABILITY_HINTS[toolName.trim().toLowerCase()] ?? [];
  const allCaps = [...new Set([...capabilities, ...hinted, ...(toolEil.capabilities ?? [])])];
  let merged: ToolEilConfig = { ...CAPABILITY_ARG_PROFILES.lookup, ...toolEil };
  for (const cap of allCaps) {
    const profile = CAPABILITY_ARG_PROFILES[cap];
    if (!profile) continue;
    merged = {
      ...merged,
      argDefaults: { ...profile.argDefaults, ...merged.argDefaults },
      argAliases: { ...profile.argAliases, ...merged.argAliases },
      entityArgMap: { ...profile.entityArgMap, ...merged.entityArgMap },
      messageArg: merged.messageArg ?? profile.messageArg,
      nestedGroups: [...(profile.nestedGroups ?? []), ...(merged.nestedGroups ?? [])],
    };
  }
  return merged;
}

function flattenFacts(facts: TurnContext["facts"]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!facts || typeof facts !== "object") return args;
  for (const [k, v] of Object.entries(facts)) {
    if (k.startsWith("__") && k !== "__travelFormMessage" && k !== "__embraturReferenceCatalog") continue;
    if (v === undefined || v === null) continue;
    let scalar: unknown = v;
    if (typeof v === "object" && !Array.isArray(v) && "value" in (v as object)) {
      scalar = (v as { value?: unknown }).value;
    }
    if (typeof scalar === "string" || typeof scalar === "number" || typeof scalar === "boolean") {
      if (!(k in args)) args[k] = scalar;
    }
  }
  return args;
}

function applyArgAliases(args: Record<string, unknown>, aliases: Record<string, string[]>): void {
  for (const [target, sources] of Object.entries(aliases)) {
    if (args[target] !== undefined && args[target] !== null && String(args[target]).trim() !== "") {
      continue;
    }
    for (const src of sources) {
      const v = args[src];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        args[target] = v;
        break;
      }
    }
  }
  // Propagate resolved targets back to all alias keys (bidirectional fill).
  for (const [target, sources] of Object.entries(aliases)) {
    const resolved = args[target];
    if (resolved === undefined || resolved === null || String(resolved).trim() === "") continue;
    for (const src of sources) {
      if (args[src] === undefined || args[src] === null || String(args[src]).trim() === "") {
        args[src] = resolved;
      }
    }
  }
}

function applyNestedGroups(
  args: Record<string, unknown>,
  groups: Array<{ target: string; fieldMap: Record<string, string[]> }>,
): void {
  for (const group of groups) {
    const nested: Record<string, unknown> = {};
    for (const [field, keys] of Object.entries(group.fieldMap)) {
      for (const k of keys) {
        const v = args[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          nested[field] = v;
          break;
        }
      }
    }
    if (Object.keys(nested).length > 0) {
      args[group.target] = nested;
    }
  }
}

function resolveLocatorFromFacts(args: Record<string, unknown>): void {
  const locatorKeys = [
    "reservationIdOrLocalizer",
    "localizadorOuReservationId",
    "localizador",
    "localizer",
    "uid",
    "reference",
    "reservationId",
  ];
  let locator: string | undefined;
  for (const k of locatorKeys) {
    const x = args[k];
    if (typeof x === "string" && x.trim().length >= 4) {
      locator = x.trim();
      break;
    }
    if (typeof x === "number" && Number.isFinite(x) && String(x).length >= 4) {
      locator = String(x);
      break;
    }
  }
  if (!locator) return;
  args.reservationIdOrLocalizer = locator;
  args.localizadorOuReservationId = args.localizadorOuReservationId ?? locator;
  for (const k of ["localizador", "localizer", "reference"]) {
    if (args[k] === undefined || args[k] === null || String(args[k]).trim() === "") {
      args[k] = locator;
    }
  }
}

function extractReferenceFromMessage(msg: string): string {
  return msg.match(REFERENCE_CODE_RE)?.[0]?.toUpperCase() ?? "";
}

export type ResolveSchemaToolArgsOpts = {
  toolName: string;
  turnContext: TurnContext;
  graph?: CapabilityGraph | null;
  toolEil?: ToolEilConfig;
};

/**
 * Resolve args de invocação a partir de Intent + Facts + schema metadata.
 * Zero imports de domínio — perfis vêm de config.eil e CAPABILITY_ARG_PROFILES.
 */
export function resolveSchemaToolArgs(opts: ResolveSchemaToolArgsOpts): Record<string, unknown> {
  const { toolName, turnContext } = opts;
  const msg = turnContext.userMessage.trim();
  const entities = turnContext.intent.entities;
  const graph = opts.graph ?? turnContext.capabilityGraph ?? null;
  const node = graph ? findCapabilityNode(graph, toolName) : undefined;
  const capabilities = node?.capabilities ?? [];
  const baseEil = opts.toolEil ?? {};
  const eil = mergeEilProfiles(baseEil, capabilities, toolName);

  const messageArg =
    eil.messageArg ?? TOOL_MESSAGE_ARGS[toolName.trim().toLowerCase()];
  if (messageArg) {
    return { [messageArg]: msg };
  }

  const args: Record<string, unknown> = { ...flattenFacts(turnContext.facts) };

  if (eil.argDefaults) {
    for (const [k, v] of Object.entries(eil.argDefaults)) {
      if (!(k in args)) args[k] = v;
    }
  }

  const refFromEntity =
    (typeof entities.referenceCode === "string" && entities.referenceCode.trim()) ||
    extractReferenceFromMessage(msg) ||
    "";

  if (refFromEntity && eil.entityArgMap?.referenceCode) {
    for (const argName of eil.entityArgMap.referenceCode) {
      args[argName] = args[argName] ?? refFromEntity;
    }
  }

  if (entities.documentNumber && eil.entityArgMap?.documentNumber) {
    for (const argName of eil.entityArgMap.documentNumber) {
      args[argName] = args[argName] ?? entities.documentNumber;
    }
  }

  if (eil.argAliases) {
    applyArgAliases(args, eil.argAliases);
  }

  resolveLocatorFromFacts(args);

  if (eil.nestedGroups?.length) {
    applyNestedGroups(args, eil.nestedGroups);
  }

  if (Object.keys(args).length === 0 && msg) {
    args.user_message = msg;
  }

  return args;
}

/** Outcome teve lookup/reservation fact producer — para appendix sem regex de tool name. */
export function outcomeHasLookupCapability(
  toolName: string,
  graph: CapabilityGraph | null | undefined,
  structuredPayload?: unknown,
): boolean {
  if (graph) {
    const node = findCapabilityNode(graph, toolName);
    if (node) {
      if (
        node.capabilities.includes("lookup") ||
        node.produces.some((p) => /reservation/i.test(p))
      ) {
        return true;
      }
    }
  }
  if (TOOL_CAPABILITY_HINTS[toolName.trim().toLowerCase()]?.includes("lookup")) {
    return true;
  }
  if (structuredPayload && typeof structuredPayload === "object" && !Array.isArray(structuredPayload)) {
    return Object.keys(structuredPayload as Record<string, unknown>).some((k) =>
      /reservation|checkin|checkout|localizador/i.test(k),
    );
  }
  return false;
}
