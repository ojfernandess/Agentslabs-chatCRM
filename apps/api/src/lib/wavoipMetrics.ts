import { endOfDay, startOfDay, subDays } from "date-fns";
import { prisma } from "../db.js";

export type WavoipMetricsQuery = {
  organizationId: string;
  from?: Date;
  to?: Date;
  deviceId?: string;
};

export type WavoipMetricsResponse = {
  range: { from: string; to: string };
  summary: {
    totalCalls: number;
    incoming: number;
    outgoing: number;
    ended: number;
    failed: number;
    rejected: number;
    notAnswered: number;
    answerRate: number;
    avgDurationSec: number | null;
    recordedCalls: number;
  };
  byDay: Array<{
    date: string;
    total: number;
    ended: number;
    failed: number;
  }>;
  byDevice: Array<{
    deviceId: string;
    deviceName: string;
    total: number;
    ended: number;
    failed: number;
    avgDurationSec: number | null;
  }>;
  byStatus: Array<{ status: string; count: number }>;
};

function parseRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  const rangeTo = to ? endOfDay(to) : endOfDay(now);
  const rangeFrom = from ? startOfDay(from) : startOfDay(subDays(rangeTo, 29));
  return { from: rangeFrom, to: rangeTo };
}

export async function getWavoipMetrics(query: WavoipMetricsQuery): Promise<WavoipMetricsResponse> {
  const { from, to } = parseRange(query.from, query.to);
  const where = {
    organizationId: query.organizationId,
    createdAt: { gte: from, lte: to },
    ...(query.deviceId ? { wavoipDeviceId: query.deviceId } : {}),
  };

  const [logs, devices] = await Promise.all([
    prisma.wavoipCallLog.findMany({
      where,
      select: {
        direction: true,
        status: true,
        durationSec: true,
        recordUrl: true,
        createdAt: true,
        wavoipDeviceId: true,
        wavoipDevice: { select: { name: true } },
      },
    }),
    prisma.wavoipDevice.findMany({
      where: { organizationId: query.organizationId },
      select: { id: true, name: true },
    }),
  ]);

  const deviceNameById = new Map(devices.map((d) => [d.id, d.name]));

  let incoming = 0;
  let outgoing = 0;
  let ended = 0;
  let failed = 0;
  let rejected = 0;
  let notAnswered = 0;
  let recordedCalls = 0;
  let durationSum = 0;
  let durationCount = 0;

  const dayMap = new Map<string, { total: number; ended: number; failed: number }>();
  const deviceMap = new Map<
    string,
    { total: number; ended: number; failed: number; durationSum: number; durationCount: number }
  >();
  const statusMap = new Map<string, number>();

  for (const log of logs) {
    const status = (log.status ?? "").toUpperCase();
    if (log.direction === "INCOMING") incoming += 1;
    if (log.direction === "OUTGOING") outgoing += 1;
    if (status === "ENDED") ended += 1;
    if (status === "FAILED") failed += 1;
    if (status === "REJECTED") rejected += 1;
    if (status === "NOT_ANSWERED") notAnswered += 1;
    if (log.recordUrl) recordedCalls += 1;

    if (log.durationSec != null && log.durationSec > 0) {
      durationSum += log.durationSec;
      durationCount += 1;
    }

    const dayKey = log.createdAt.toISOString().slice(0, 10);
    const day = dayMap.get(dayKey) ?? { total: 0, ended: 0, failed: 0 };
    day.total += 1;
    if (status === "ENDED") day.ended += 1;
    if (status === "FAILED" || status === "REJECTED") day.failed += 1;
    dayMap.set(dayKey, day);

    statusMap.set(status, (statusMap.get(status) ?? 0) + 1);

    const dev = deviceMap.get(log.wavoipDeviceId) ?? {
      total: 0,
      ended: 0,
      failed: 0,
      durationSum: 0,
      durationCount: 0,
    };
    dev.total += 1;
    if (status === "ENDED") dev.ended += 1;
    if (status === "FAILED" || status === "REJECTED") dev.failed += 1;
    if (log.durationSec != null && log.durationSec > 0) {
      dev.durationSum += log.durationSec;
      dev.durationCount += 1;
    }
    deviceMap.set(log.wavoipDeviceId, dev);
  }

  const totalCalls = logs.length;
  const terminal = ended + failed + rejected + notAnswered;
  const answerRate = terminal > 0 ? Math.round((ended / terminal) * 1000) / 10 : 0;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      totalCalls,
      incoming,
      outgoing,
      ended,
      failed,
      rejected,
      notAnswered,
      answerRate,
      avgDurationSec: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
      recordedCalls,
    },
    byDay: [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
    byDevice: [...deviceMap.entries()]
      .map(([deviceId, v]) => ({
        deviceId,
        deviceName: deviceNameById.get(deviceId) ?? deviceId,
        total: v.total,
        ended: v.ended,
        failed: v.failed,
        avgDurationSec: v.durationCount > 0 ? Math.round(v.durationSum / v.durationCount) : null,
      }))
      .sort((a, b) => b.total - a.total),
    byStatus: [...statusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
  };
}
