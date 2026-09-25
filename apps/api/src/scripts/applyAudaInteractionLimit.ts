/**
 * Ajusta o limite de interações do agente Auda (Controle de atendimento).
 *
 * Usage (from apps/api, with DATABASE_URL reachable):
 *   npx tsx src/scripts/applyAudaInteractionLimit.ts
 *
 * Env:
 *   EIL_BOT_ID=e8ca18c8-3088-4e75-b381-0d3163011584
 *   AUDA_INTERACTION_LIMIT=20
 */
import { PrismaClient } from "@prisma/client";
import { parseInteractionLimitFromBehavior } from "../lib/interactionBudget.js";

const BOT_ID = process.env.EIL_BOT_ID ?? "e8ca18c8-3088-4e75-b381-0d3163011584";
const TARGET_LIMIT = Math.max(
  1,
  Math.min(500, Math.floor(Number(process.env.AUDA_INTERACTION_LIMIT ?? 20) || 20)),
);

async function main() {
  const prisma = new PrismaClient();
  try {
    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId: BOT_ID },
      select: { id: true, organizationId: true, behaviorConfig: true },
    });
    if (!profile) throw new Error(`Agent profile not found for bot ${BOT_ID}`);

    const behavior =
      profile.behaviorConfig && typeof profile.behaviorConfig === "object"
        ? { ...(profile.behaviorConfig as Record<string, unknown>) }
        : {};
    const current = parseInteractionLimitFromBehavior(behavior);
    const rawIl =
      behavior.interactionLimit && typeof behavior.interactionLimit === "object"
        ? { ...(behavior.interactionLimit as Record<string, unknown>) }
        : {};

    behavior.interactionLimit = {
      ...rawIl,
      enabled: true,
      limit: TARGET_LIMIT,
      offerWebchatOnLimit: current.offerWebchatOnLimit,
      webchatMessageOnLimit: current.webchatMessageOnLimit,
      inboxIds: current.inboxIds,
    };

    await prisma.automationAgentProfile.update({
      where: { id: profile.id },
      data: { behaviorConfig: behavior },
    });

    console.log(
      JSON.stringify(
        {
          botId: BOT_ID,
          organizationId: profile.organizationId,
          previousLimit: current.limit,
          newLimit: TARGET_LIMIT,
          enabled: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
