import { prisma } from "../../../db.js";
import type { Prisma } from "@prisma/client";

/** Default policy bundle for additional-party constraint (segment-agnostic action id). */
export const DEFAULT_ADDITIONAL_PARTY_EIL = {
  enabled: true,
  policies: [
    {
      id: "party_requires_n_gt_1",
      action: "request_additional_party",
      requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
    },
  ],
} as const;

export const DEFAULT_RESERVATION_LOOKUP_TOOL_EIL = {
  produces: [
    "guestsQuantity",
    "reservationStatus",
    "checkinStatus",
    "localizadorOuReservationId",
    "reservationId",
  ],
  capabilities: ["lookup_reservation"],
  factPaths: {
    guestsQuantity: "stay.guestsQuantity",
    reservationStatus: "stay.status",
    checkinStatus: "stay.checkinStatus",
    localizadorOuReservationId: "stay.localizer",
    reservationId: "stay.reservationId",
  },
} as const;

export const DEFAULT_MAIN_GUEST_TOOL_EIL = {
  produces: [
    "mainGuestId",
    "documentNumber",
    "email",
    "birthDate",
    "name",
    "phone",
    "mobilePhoneNumber",
    "gender",
    "profession",
    "citizenship",
    "zipCode",
    "country",
    "state",
    "city",
    "street",
    "number",
    "neighborhood",
    "documentType",
    "profilePhotoId",
    "documentPhotoId",
    "profilePhotoUrl",
    "documentPhotoUrl",
    "found",
  ],
  capabilities: ["lookup_main_guest"],
  factPaths: {
    mainGuestId: "mainGuest.id",
    documentNumber: "mainGuest.documentNumber",
    email: "mainGuest.email",
    birthDate: "mainGuest.birthDate",
    name: "mainGuest.name",
    phone: "mainGuest.mobilePhoneNumber",
    mobilePhoneNumber: "mainGuest.mobilePhoneNumber",
    gender: "mainGuest.gender",
    profession: "mainGuest.profession",
    citizenship: "mainGuest.citizenship",
    zipCode: "mainGuest.zipCode",
    country: "mainGuest.country",
    state: "mainGuest.state",
    city: "mainGuest.city",
    street: "mainGuest.street",
    number: "mainGuest.number",
    neighborhood: "mainGuest.neighborhood",
    documentType: "mainGuest.documentType",
    profilePhotoId: "mainGuest.profilePhotoId",
    documentPhotoId: "mainGuest.documentPhotoId",
    profilePhotoUrl: "mainGuest.profilePhotoUrl",
    documentPhotoUrl: "mainGuest.documentPhotoUrl",
    found: "found",
  },
} as const;

export const DEFAULT_CHECK_IN_TOOL_EIL = {
  produces: ["checkinCompleted", "reservationStatus"],
  requiresFacts: [
    "documentNumber",
    "email",
    "mainGuestId",
    "snmotvia",
    "sntiptran",
    "bgstdscpais",
    "bgstdscpaisdest",
    "snidcidadeibge",
    "snidcidadeibgedest",
  ],
  capabilities: ["complete_checkin"],
  factPaths: {
    checkinCompleted: "ok",
    reservationStatus: "status",
  },
} as const;

export const DEFAULT_EMBRATUR_TOOL_EIL = {
  produces: ["embraturReference", "travelMotives"],
  capabilities: ["lookup_embratur_reference"],
} as const;

export type ToolEilBinding = {
  pattern: RegExp;
  eil: Record<string, unknown>;
};

export const DEFAULT_TOOL_EIL_BINDINGS: ToolEilBinding[] = [
  { pattern: /consultar_reserva/i, eil: { ...DEFAULT_RESERVATION_LOOKUP_TOOL_EIL } },
  { pattern: /consultar_main_guest|main_guest/i, eil: { ...DEFAULT_MAIN_GUEST_TOOL_EIL } },
  { pattern: /check_in|checkin/i, eil: { ...DEFAULT_CHECK_IN_TOOL_EIL } },
  { pattern: /embratur|reference/i, eil: { ...DEFAULT_EMBRATUR_TOOL_EIL } },
];

export type ApplyEilConfigResult = {
  botId: string;
  profileId: string;
  eilEnabled: boolean;
  policyIds: string[];
  toolsUpdated: Array<{ id: string; name: string }>;
};

/**
 * Merge behaviorConfig.eil + tool.config.eil for an agent (platform write path).
 * Preserves all existing behavior/tool config keys.
 */
export async function applyEilConfigToAgent(opts: {
  organizationId: string;
  botId: string;
  eil?: Record<string, unknown>;
  toolEilBindings?: ToolEilBinding[];
  /** Merge opcional em cada binding (ex.: MCP `toolEil` override). */
  toolEil?: Record<string, unknown>;
}): Promise<ApplyEilConfigResult> {
  const eilBundle = opts.eil ?? { ...DEFAULT_ADDITIONAL_PARTY_EIL };
  const baseBindings = opts.toolEilBindings ?? DEFAULT_TOOL_EIL_BINDINGS;
  const bindings: ToolEilBinding[] = opts.toolEil
    ? baseBindings.map((b) => ({
        pattern: b.pattern,
        eil: { ...b.eil, ...opts.toolEil },
      }))
    : baseBindings;

  const profile = await prisma.automationAgentProfile.findFirst({
    where: { botId: opts.botId, organizationId: opts.organizationId },
    select: { id: true, behaviorConfig: true },
  });
  if (!profile) {
    throw new Error(`Agent profile not found for bot ${opts.botId}`);
  }

  const beh =
    profile.behaviorConfig && typeof profile.behaviorConfig === "object"
      ? ({ ...(profile.behaviorConfig as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  beh.eil = { ...(typeof beh.eil === "object" && beh.eil ? (beh.eil as object) : {}), ...eilBundle };

  await prisma.automationAgentProfile.update({
    where: { id: profile.id },
    data: { behaviorConfig: beh as Prisma.InputJsonValue },
  });

  const tools = await prisma.automationCustomTool.findMany({
    where: {
      organizationId: opts.organizationId,
      OR: [{ botId: opts.botId }, { botId: null }],
    },
    select: { id: true, name: true, config: true, botId: true },
  });

  const toolsUpdated: Array<{ id: string; name: string }> = [];
  for (const tool of tools) {
    const binding = bindings.find((b) => b.pattern.test(tool.name));
    if (!binding) continue;
    const cfg =
      tool.config && typeof tool.config === "object"
        ? ({ ...(tool.config as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const prevEil =
      cfg.eil && typeof cfg.eil === "object" ? (cfg.eil as Record<string, unknown>) : {};
    cfg.eil = { ...prevEil, ...binding.eil };
    await prisma.automationCustomTool.update({
      where: { id: tool.id },
      data: { config: cfg as Prisma.InputJsonValue },
    });
    toolsUpdated.push({ id: tool.id, name: tool.name });
  }

  const policies = Array.isArray((eilBundle as { policies?: unknown }).policies)
    ? ((eilBundle as { policies: Array<{ id?: string }> }).policies
        .map((p) => p.id)
        .filter((id): id is string => typeof id === "string"))
    : [];

  return {
    botId: opts.botId,
    profileId: profile.id,
    eilEnabled: (eilBundle as { enabled?: boolean }).enabled !== false,
    policyIds: policies,
    toolsUpdated,
  };
}
