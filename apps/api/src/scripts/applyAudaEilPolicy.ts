/**
 * Seed: merge EIL policy + tool produces into Auda (or any agent).
 *
 * Usage (from apps/api, with DATABASE_URL reachable):
 *   npx tsx src/scripts/applyAudaEilPolicy.ts
 *
 * Env:
 *   EIL_BOT_ID=e8ca18c8-3088-4e75-b381-0d3163011584
 *   EIL_ORGANIZATION_ID=<uuid>  (optional — inferred from profile if omitted)
 */
import { PrismaClient } from "@prisma/client";
import { applyEilConfigToAgent } from "../lib/mcp/eil/applyEilConfig.js";

const BOT_ID = process.env.EIL_BOT_ID ?? "e8ca18c8-3088-4e75-b381-0d3163011584";

async function main() {
  const prisma = new PrismaClient();
  try {
    let organizationId = process.env.EIL_ORGANIZATION_ID?.trim();
    if (!organizationId) {
      const profile = await prisma.automationAgentProfile.findFirst({
        where: { botId: BOT_ID },
        select: { organizationId: true },
      });
      if (!profile) throw new Error(`Agent profile not found for bot ${BOT_ID}`);
      organizationId = profile.organizationId;
    }

    const result = await applyEilConfigToAgent({
      organizationId,
      botId: BOT_ID,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
