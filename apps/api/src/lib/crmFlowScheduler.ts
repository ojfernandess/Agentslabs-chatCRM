import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { continueCrmFlowExecution } from "./crmFlowExecutor.js";
import type { CrmFlowContext } from "./crmFlowContext.js";

/** Retoma execuções CRM pausadas em blocos de espera. */
export async function runCrmFlowSchedulerTick(app: FastifyInstance): Promise<void> {
  const now = new Date();
  const jobs = await prisma.crmFlowWaitJob.findMany({
    where: { resumeAt: { lte: now } },
    take: 30,
    include: {
      crmFlow: true,
      execution: true,
    },
  });

  for (const job of jobs) {
    if (!job.crmFlow || !job.execution) continue;
    if (job.execution.status !== "WAITING" && job.execution.status !== "RUNNING") {
      await prisma.crmFlowWaitJob.delete({ where: { id: job.id } }).catch(() => undefined);
      continue;
    }

    try {
      const result = await continueCrmFlowExecution({
        flow: job.crmFlow,
        organizationId: job.organizationId,
        executionId: job.executionId,
        startNodeId: job.nextNodeId,
        ctx: job.context as CrmFlowContext,
        triggerType: job.execution.triggerType ?? "wait_resume",
        log: app.log,
      });

      await prisma.crmFlowWaitJob.delete({ where: { id: job.id } });
    } catch (err) {
      app.log.warn({ err, jobId: job.id }, "crm flow wait resume failed");
    }
  }
}
