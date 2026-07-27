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
  produces: ["guestsQuantity", "reservationStatus", "checkinStatus", "localizadorOuReservationId"],
  capabilities: ["lookup_reservation"],
  factPaths: {
    guestsQuantity: "stay.guestsQuantity",
    reservationStatus: "stay.status",
    checkinStatus: "stay.checkinStatus",
    localizadorOuReservationId: "stay.localizer",
  },
} as const;

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
  reservationToolNamePattern?: RegExp;
  toolEil?: Record<string, unknown>;
}): Promise<ApplyEilConfigResult> {
  const eilBundle = opts.eil ?? { ...DEFAULT_ADDITIONAL_PARTY_EIL };
  const toolEil = opts.toolEil ?? { ...DEFAULT_RESERVATION_LOOKUP_TOOL_EIL };
  const nameRe = opts.reservationToolNamePattern ?? /consultar_reserva/i;

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
  beh.eil = eilBundle;

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
    if (!nameRe.test(tool.name)) continue;
    const cfg =
      tool.config && typeof tool.config === "object"
        ? ({ ...(tool.config as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const prevEil =
      cfg.eil && typeof cfg.eil === "object" ? (cfg.eil as Record<string, unknown>) : {};
    cfg.eil = { ...prevEil, ...toolEil };
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
