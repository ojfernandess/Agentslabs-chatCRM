import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { FastifyInstance } from "fastify";
import { dispatchCrmFlowTrigger } from "./crmFlowExecutor.js";

const QUEUE_NAME = "crm-flow-triggers";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
let redisQueueOperational = false;

export type CrmFlowTriggerJobData = {
  organizationId: string;
  triggerType: string;
  payload: Record<string, unknown>;
};

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

export function isCrmFlowQueueAvailable(): boolean {
  return redisQueueOperational;
}

function markRedisDown(): void {
  redisQueueOperational = false;
}

function getConnection(): IORedis {
  if (!connection) {
    const url = getRedisUrl();
    if (!url) throw new Error("REDIS_URL not configured");
    connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      connectTimeout: 10_000,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
    });
    connection.on("error", (err) => {
      markRedisDown();
      console.error("[crm-flow-queue] redis connection error", err.message);
    });
  }
  return connection;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

export async function enqueueCrmFlowTriggerJob(
  data: CrmFlowTriggerJobData,
): Promise<boolean> {
  if (!redisQueueOperational) return false;
  try {
    const q = getQueue();
    await q.add("dispatch-trigger", data, {
      removeOnComplete: 2000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 1500 },
    });
    return true;
  } catch (err) {
    markRedisDown();
    console.error(
      "[crm-flow-queue] enqueue failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

function registerWorker(app: FastifyInstance): void {
  if (worker || !connection) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<CrmFlowTriggerJobData>) => {
      await dispatchCrmFlowTrigger({
        organizationId: job.data.organizationId,
        triggerType: job.data.triggerType,
        payload: job.data.payload,
        log: app.log,
      });
    },
    { connection, concurrency: 3 },
  );

  worker.on("failed", (job, err) => {
    app.log.warn({ err, jobId: job?.id }, "crm flow queue job failed");
  });
}

export async function initCrmFlowQueue(app: FastifyInstance): Promise<void> {
  const url = getRedisUrl();
  if (!url) {
    app.log.info("crm flow queue skipped (no REDIS_URL)");
    return;
  }

  try {
    const probe = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    await probe.connect();
    await probe.ping();
    await probe.quit();

    connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      connectTimeout: 10_000,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
    });
    connection.on("error", (err) => {
      markRedisDown();
      app.log.warn({ err: err.message }, "crm flow queue redis error");
    });

    registerWorker(app);
    redisQueueOperational = true;
    app.log.info("crm flow queue worker ready (redis)");
  } catch (err) {
    markRedisDown();
    await connection?.quit().catch(() => {});
    connection = null;
    queue = null;
    worker = null;
    app.log.warn(
      { err: err instanceof Error ? err.message : err },
      "crm flow queue unavailable; triggers run in-process",
    );
  }
}

export async function closeCrmFlowQueue(): Promise<void> {
  markRedisDown();
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = null;
  queue = null;
  connection = null;
}
