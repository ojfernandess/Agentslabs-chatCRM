import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { FastifyInstance } from "fastify";
import type { ContactSyncPatch, IncomingMessage } from "../providers/types.js";
import { buildMetaInboundJobId, claimMetaInboundWaMessageId } from "./metaInboundDedupe.js";
import { processWhatsAppWebhookEvents } from "./whatsappInboundProcessor.js";

const QUEUE_NAME = "meta-inbound-webhooks";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
let redisQueueOperational = false;

let enqueueSuccessCount = 0;
let enqueueDuplicateCount = 0;
let enqueueFailedCount = 0;

export type MetaInboundQueueJobData = {
  organizationId: string;
  inboxId: string;
  whatsappProvider: string;
  body: unknown;
  receivedAt: string;
};

export type QueueWorkerInitOptions = {
  registerWorker?: boolean;
};

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

export function isMetaInboundQueueAvailable(): boolean {
  return redisQueueOperational;
}

export function getMetaInboundQueueMetrics() {
  const dedupeTotal = enqueueSuccessCount + enqueueDuplicateCount;
  return {
    enqueueSuccessCount,
    enqueueDuplicateCount,
    enqueueFailedCount,
    queueOperational: redisQueueOperational,
    /** Retries Meta / dedupe hits — proxy para taxa de reenvio do webhook. */
    metaRetryRatePercent:
      dedupeTotal > 0
        ? Math.round((enqueueDuplicateCount / dedupeTotal) * 10_000) / 100
        : null,
  };
}

export async function getMetaInboundQueueDiagnostics() {
  const metrics = getMetaInboundQueueMetrics();
  let jobCounts: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
  } | null = null;
  if (redisQueueOperational && queue) {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
      jobCounts = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      };
    } catch {
      jobCounts = null;
    }
  }
  return {
    redisUrlConfigured: Boolean(getRedisUrl()),
    queueOperational: redisQueueOperational,
    queueName: QUEUE_NAME,
    metrics,
    jobCounts,
  };
}

export function shouldQueueMetaInboundWebhook(input: {
  whatsappProvider: string;
  messages: IncomingMessage[];
  contactSync?: ContactSyncPatch[];
}): boolean {
  if (input.whatsappProvider !== "meta" && input.whatsappProvider !== "360dialog") {
    return false;
  }
  const hasMessages = input.messages.length > 0;
  const hasContactSync = (input.contactSync?.length ?? 0) > 0;
  return hasMessages || hasContactSync;
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
      console.error("[meta-inbound-queue] redis connection error", err.message);
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

export async function enqueueMetaInboundWebhookJob(
  data: MetaInboundQueueJobData & { messageWaIds: string[] },
): Promise<boolean> {
  if (!redisQueueOperational) return false;

  const waIds = data.messageWaIds.map((id) => id.trim()).filter(Boolean);
  if (waIds.length > 0) {
    let anyNew = false;
    for (const waId of waIds) {
      const claimed = await claimMetaInboundWaMessageId(data.organizationId, waId);
      if (claimed) anyNew = true;
    }
    if (!anyNew) {
      enqueueDuplicateCount += 1;
      return true;
    }
  }

  try {
    const q = getQueue();
    await q.add("process-inbound", data, {
      jobId: buildMetaInboundJobId(data.organizationId, data.inboxId, waIds),
      removeOnComplete: 5000,
      removeOnFail: 10_000,
      attempts: 3,
      backoff: { type: "exponential", delay: 1500 },
    });
    enqueueSuccessCount += 1;
    return true;
  } catch (err) {
    enqueueFailedCount += 1;
    markRedisDown();
    console.error(
      "[meta-inbound-queue] enqueue failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

function registerWorkerFn(app: FastifyInstance): void {
  if (worker || !connection) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<MetaInboundQueueJobData>) => {
      await processMetaInboundJobProper(job.data, app);
    },
    { connection, concurrency: 3 },
  );

  worker.on("failed", (job, err) => {
    app.log.warn({ err, jobId: job?.id }, "meta inbound queue job failed");
  });
}

async function processMetaInboundJobProper(
  data: MetaInboundQueueJobData,
  app: FastifyInstance,
): Promise<void> {
  const started = Date.now();
  const { getWhatsAppProviderForInbox } = await import("../providers/factory.js");
  const provider = await getWhatsAppProviderForInbox(data.organizationId, data.inboxId);
  if (!provider) {
    throw new Error("meta_inbound_provider_missing");
  }
  const parsed = provider.parseWebhook({}, data.body);
  const processed = await processWhatsAppWebhookEvents({
    app,
    organizationId: data.organizationId,
    target: { inboxId: data.inboxId, whatsappProvider: data.whatsappProvider },
    body: data.body,
    messages: parsed.messages,
    statusUpdates: [],
    reactionUpdates: [],
    contactSync: parsed.contactSync,
    scope: "messages_and_contacts",
  });
  const lagMs = Date.now() - new Date(data.receivedAt).getTime();
  const { recordLatencySample } = await import("./platform-observability/latencySampler.js");
  recordLatencySample("meta_inbound_queue_lag", lagMs);
  app.log.info(
    {
      organizationId: data.organizationId,
      inboxId: data.inboxId,
      processedEvents: processed,
      durationMs: Date.now() - started,
      lagMs,
    },
    "meta inbound queue job completed",
  );
}

export async function initMetaInboundQueue(
  app: FastifyInstance,
  options: QueueWorkerInitOptions = {},
): Promise<void> {
  const registerWorker = options.registerWorker ?? true;
  const url = getRedisUrl();
  if (!url) {
    app.log.info("meta inbound queue skipped (no REDIS_URL)");
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
      app.log.warn({ err: err.message }, "meta inbound queue redis error");
    });

    if (registerWorker) {
      registerWorkerFn(app);
      app.log.info("meta inbound queue ready (worker registered)");
    } else {
      app.log.info("meta inbound queue ready (producer only)");
    }
    redisQueueOperational = true;
  } catch (err) {
    markRedisDown();
    app.log.warn(
      { err: err instanceof Error ? err.message : err },
      "meta inbound queue init failed — sync fallback",
    );
  }
}

export async function closeMetaInboundQueue(): Promise<void> {
  redisQueueOperational = false;
  await worker?.close().catch(() => {});
  await queue?.close().catch(() => {});
  connection?.disconnect();
  worker = null;
  queue = null;
  connection = null;
}
