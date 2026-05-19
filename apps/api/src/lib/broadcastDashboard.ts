import { prisma } from "../db.js";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface BroadcastDashboardPayload {
  metrics: {
    sentToday: number;
    deliveryRate: number | null;
    responseRate: number | null;
    conversions: number | null;
    leadsGenerated: number;
    activeCampaigns: number;
    failedMessages: number;
    roi: number | null;
    totalSent: number;
    totalRecipients: number;
  };
  statusBreakdown: Record<string, number>;
  topCampaigns: {
    id: string;
    name: string;
    status: string;
    sentCount: number;
    failedCount: number;
    totalRecipients: number;
    deliveryRate: number | null;
  }[];
  sendByDay: { date: string; sent: number; failed: number }[];
}

export async function buildBroadcastDashboard(organizationId: string): Promise<BroadcastDashboardPayload> {
  const todayStart = startOfToday();

  const [campaigns, sentToday] = await Promise.all([
    prisma.broadcastCampaign.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        sentCount: true,
        failedCount: true,
        totalRecipients: true,
        responseCount: true,
        conversionCount: true,
        roiValue: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.broadcastCampaignRecipient.count({
      where: {
        campaign: { organizationId },
        status: "SENT",
        sentAt: { gte: todayStart },
      },
    }),
  ]);

  let totalSent = 0;
  let totalFailed = 0;
  let totalRecipients = 0;
  let totalResponses = 0;
  let totalConversions = 0;
  let totalRoi = 0;
  let activeCampaigns = 0;
  const statusBreakdown: Record<string, number> = {};

  for (const c of campaigns) {
    totalSent += c.sentCount;
    totalFailed += c.failedCount;
    totalRecipients += c.totalRecipients;
    totalResponses += c.responseCount;
    totalConversions += c.conversionCount;
    if (c.roiValue) totalRoi += Number(c.roiValue);
    if (c.status === "RUNNING") activeCampaigns += 1;
    statusBreakdown[c.status] = (statusBreakdown[c.status] ?? 0) + 1;
  }

  const attempted = totalSent + totalFailed;
  const deliveryRate = attempted > 0 ? Math.round((totalSent / attempted) * 1000) / 10 : null;
  const responseRate = totalSent > 0 ? Math.round((totalResponses / totalSent) * 1000) / 10 : null;
  const conversions = totalSent > 0 ? Math.round((totalConversions / totalSent) * 1000) / 10 : null;

  const topCampaigns = campaigns
    .filter((c) => c.sentCount > 0 || c.failedCount > 0)
    .slice(0, 8)
    .map((c) => {
      const att = c.sentCount + c.failedCount;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        totalRecipients: c.totalRecipients,
        deliveryRate: att > 0 ? Math.round((c.sentCount / att) * 1000) / 10 : null,
      };
    });

  const since = new Date();
  since.setDate(since.getDate() - 13);
  since.setHours(0, 0, 0, 0);

  const recentRecipients = await prisma.broadcastCampaignRecipient.findMany({
    where: {
      campaign: { organizationId },
      OR: [{ sentAt: { gte: since } }, { createdAt: { gte: since } }],
    },
    select: { status: true, sentAt: true, createdAt: true },
  });

  const dayMap = new Map<string, { sent: number; failed: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, { sent: 0, failed: 0 });
  }

  for (const r of recentRecipients) {
    const day = (r.sentAt ?? r.createdAt).toISOString().slice(0, 10);
    if (!dayMap.has(day)) continue;
    const bucket = dayMap.get(day)!;
    if (r.status === "SENT") bucket.sent += 1;
    else if (r.status === "FAILED") bucket.failed += 1;
  }

  const sendByDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const leadsGenerated = campaigns
    .filter((c) => c.status === "COMPLETED")
    .reduce((sum, c) => sum + c.totalRecipients, 0);

  return {
    metrics: {
      sentToday,
      deliveryRate,
      responseRate,
      conversions,
      leadsGenerated,
      activeCampaigns,
      failedMessages: totalFailed,
      roi: totalRoi > 0 ? totalRoi : null,
      totalSent,
      totalRecipients,
    },
    statusBreakdown,
    topCampaigns,
    sendByDay,
  };
}
