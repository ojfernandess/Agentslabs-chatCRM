import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { computeScheduleNextRunAt, runLeadFinderScheduleJob } from "./leadFinderJobRunner.js";
import { computeNextRunAt, parseFollowUpRecurrence } from "./broadcastRecurrence.js";

export async function runLeadFinderSchedulerTick(app: FastifyInstance): Promise<void> {
  const now = new Date();

  const due = await prisma.leadFinderSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
    },
    take: 5,
  });

  for (const schedule of due) {
    try {
      const result = await runLeadFinderScheduleJob(app, schedule);

      let nextRunAt: Date | null = null;
      if (schedule.scheduleType === "RECURRING" && schedule.recurrence) {
        const recurrence = parseFollowUpRecurrence({ followUpRecurrence: schedule.recurrence });
        if (recurrence) nextRunAt = computeNextRunAt(now, recurrence);
      }

      await prisma.leadFinderSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: now,
          lastRunResult: result as object,
          nextRunAt,
          ...(schedule.scheduleType === "SCHEDULED" ? { enabled: false } : {}),
        },
      });
    } catch (err) {
      app.log.error({ err, scheduleId: schedule.id }, "lead finder schedule tick failed");
      await prisma.leadFinderSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: now,
          lastRunResult: { ok: false, error: err instanceof Error ? err.message : "unknown" },
        },
      });
    }
  }
}

export { computeScheduleNextRunAt };
