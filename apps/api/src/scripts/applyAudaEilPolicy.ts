/**
 * Seed/example: merge EIL policy + tool produces into Auda (or any agent).
 * Domain stays in data — not in engine TypeScript.
 *
 * Usage (from apps/api, with DATABASE_URL reachable):
 *   npx tsx src/scripts/applyAudaEilPolicy.ts
 *
 * Env overrides:
 *   EIL_BOT_ID=e8ca18c8-3088-4e75-b381-0d3163011584
 */
import { PrismaClient } from "@prisma/client";

const BOT_ID = process.env.EIL_BOT_ID ?? "e8ca18c8-3088-4e75-b381-0d3163011584";

const EIL_POLICY_BUNDLE = {
  enabled: true,
  policies: [
    {
      id: "party_requires_n_gt_1",
      action: "request_additional_party",
      requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
    },
  ],
};

const RESERVATION_TOOL_EIL = {
  produces: ["guestsQuantity", "reservationStatus", "checkinStatus", "localizadorOuReservationId"],
  capabilities: ["lookup_reservation"],
  factPaths: {
    guestsQuantity: "stay.guestsQuantity",
    reservationStatus: "stay.status",
    checkinStatus: "stay.checkinStatus",
    localizadorOuReservationId: "stay.localizer",
  },
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId: BOT_ID },
      select: { id: true, behaviorConfig: true, organizationId: true },
    });
    if (!profile) {
      throw new Error(`Agent profile not found for bot ${BOT_ID}`);
    }

    const beh =
      profile.behaviorConfig && typeof profile.behaviorConfig === "object"
        ? ({ ...(profile.behaviorConfig as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    beh.eil = EIL_POLICY_BUNDLE;

    await prisma.automationAgentProfile.update({
      where: { id: profile.id },
      data: { behaviorConfig: beh as object },
    });

    const tools = await prisma.automationCustomTool.findMany({
      where: {
        organizationId: profile.organizationId,
        OR: [
          { botId: BOT_ID },
          { name: { contains: "consultar_reserva", mode: "insensitive" } },
          { name: { contains: "audaar_consultar_reserva", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, config: true, botId: true },
    });

    const reservationTools = tools.filter((t) =>
      /consultar_reserva|consultar.?reserva/i.test(t.name),
    );

    for (const tool of reservationTools) {
      const cfg =
        tool.config && typeof tool.config === "object"
          ? ({ ...(tool.config as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      cfg.eil = { ...(typeof cfg.eil === "object" && cfg.eil ? (cfg.eil as object) : {}), ...RESERVATION_TOOL_EIL };
      await prisma.automationCustomTool.update({
        where: { id: tool.id },
        data: { config: cfg as object },
      });
      console.log(`Updated tool.config.eil for ${tool.name} (${tool.id})`);
    }

    console.log(`Updated behaviorConfig.eil for bot ${BOT_ID} (profile ${profile.id})`);
    console.log(`Reservation tools touched: ${reservationTools.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
