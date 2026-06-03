import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { scheduleBroadcastCampaignRun } from "./broadcastRunner.js";

/** Retoma envio para campanhas RUNNING com destinatários PENDING (ex.: após queda do Redis). */
export async function resumeRunningBroadcastCampaigns(app: FastifyInstance): Promise<void> {
  const running = await prisma.broadcastCampaign.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
    take: 30,
  });
  for (const row of running) {
    const pending = await prisma.broadcastCampaignRecipient.count({
      where: { campaignId: row.id, status: "PENDING" },
    });
    if (pending > 0) {
      app.log.info({ campaignId: row.id, pending }, "resuming broadcast campaign send");
      scheduleBroadcastCampaignRun(app, row.id);
    }
  }
}
