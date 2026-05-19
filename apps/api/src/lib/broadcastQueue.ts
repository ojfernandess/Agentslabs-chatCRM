import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { FastifyInstance } from "fastify";
import { processBroadcastRecipient } from "./broadcastRecipientProcessor.js";

const QUEUE_NAME = "broadcast-campaigns";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

export function isBroadcastQueueAvailable(): boolean {
  return Boolean(getRedisUrl());
}

function getConnection(): IORedis {
  if (!connection) {
    const url = getRedisUrl();
    if (!url) throw new Error("REDIS_URL not configured");
    connection = new IORedis(url, { maxRetriesPerRequest: null });
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
  if (!isBroadcastQueueAvailable()) return null;
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
}

export function registerBroadcastQueueWorker(app: FastifyInstance): void {
  if (!isBroadcastQueueAvailable()) {
    app.log.info("broadcast queue worker skipped (no REDIS_URL)");
    return;
  }
  if (worker) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ campaignId: string; recipientId: string }>) => {
      await processBroadcastRecipient(app, job.data.campaignId, job.data.recipientId);
    },
    { connection: getConnection(), concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "broadcast queue job failed");
  });

  app.log.info("broadcast queue worker registered");
}

export async function closeBroadcastQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = null;
  queue = null;
  connection = null;
}
