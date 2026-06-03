import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { FastifyInstance } from "fastify";
import { processBroadcastRecipient } from "./broadcastRecipientProcessor.js";
import { resumeRunningBroadcastCampaigns } from "./broadcastRecovery.js";

const QUEUE_NAME = "broadcast-campaigns";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
/** True only after a successful Redis ping and worker registration. */
let redisQueueOperational = false;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

export function isBroadcastQueueAvailable(): boolean {
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
      console.error("[broadcast-queue] redis connection error", err.message);
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

export async function enqueueBroadcastRecipientJob(
  campaignId: string,
  recipientId: string,
  delayMs: number,
): Promise<string | null> {
  if (!redisQueueOperational) return null;
  try {
    const q = getQueue();
    const job = await q.add(
      "send-recipient",
      { campaignId, recipientId },
      {
        delay: Math.max(0, delayMs),
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    );
    return job.id ?? null;
  } catch (err) {
    markRedisDown();
    console.error(
      "[broadcast-queue] enqueue failed, falling back to in-process send",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function registerWorker(app: FastifyInstance): void {
  if (worker || !connection) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ campaignId: string; recipientId: string }>) => {
      await processBroadcastRecipient(app, job.data.campaignId, job.data.recipientId);
    },
    { connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "broadcast queue job failed");
  });
}

/**
 * Probes Redis and registers the BullMQ worker. On failure, campaigns still send in-process.
 */
export async function initBroadcastQueue(app: FastifyInstance): Promise<void> {
  const url = getRedisUrl();
  if (!url) {
    app.log.info("broadcast queue skipped (no REDIS_URL)");
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
      app.log.warn({ err: err.message }, "broadcast queue redis error");
    });

    registerWorker(app);
    redisQueueOperational = true;
    app.log.info("broadcast queue worker ready (redis)");
    void resumeRunningBroadcastCampaigns(app).catch((resumeErr) => {
      app.log.warn({ err: resumeErr }, "resume running broadcast campaigns failed");
    });
  } catch (err) {
    markRedisDown();
    await connection?.quit().catch(() => {});
    connection = null;
    queue = null;
    worker = null;
    app.log.warn(
      { err: err instanceof Error ? err.message : err },
      "broadcast queue unavailable; campaigns will send in-process without Redis",
    );
    void resumeRunningBroadcastCampaigns(app).catch((resumeErr) => {
      app.log.warn({ err: resumeErr }, "resume running broadcast campaigns failed");
    });
  }
}

/** @deprecated Use initBroadcastQueue */
export function registerBroadcastQueueWorker(app: FastifyInstance): void {
  void initBroadcastQueue(app);
}

export async function closeBroadcastQueue(): Promise<void> {
  markRedisDown();
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = null;
  queue = null;
  connection = null;
}
