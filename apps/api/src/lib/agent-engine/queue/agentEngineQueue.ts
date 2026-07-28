import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { ConversationPriority } from "@prisma/client";
import { prisma } from "../../../db.js";
import { attachAutomationExecutionLog } from "../../automationExecutionLog.js";
import { runNativeAgentReplyAndDeliver } from "../../agentBotNativeReplyPipeline.js";

const QUEUE_NAME = "agent-engine-replies";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
let redisQueueOperational = false;

export type AgentEngineQueueJobData = {
  organizationId: string;
  botId: string;
  conversationId: string;
  messageId: string;
  contactId: string;
  executionId: string;
};

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

export function isAgentEngineQueueAvailable(): boolean {
  return redisQueueOperational;
}

export function resolveAgentEngineQueuePriority(
  priority: ConversationPriority | null | undefined,
): number {
  switch (priority) {
    case "URGENT":
      return 20;
    case "HIGH":
      return 15;
    case "LOW":
      return 1;
    default:
      return 5;
  }
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
      console.error("[agent-engine-queue] redis connection error", err.message);
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

export async function enqueueAgentEngineReplyJob(
  data: AgentEngineQueueJobData,
  priority = 5,
): Promise<boolean> {
  if (!redisQueueOperational) return false;
  try {
    const q = getQueue();
    await q.add("native-reply", data, {
      priority,
      removeOnComplete: 2000,
      removeOnFail: 5000,
      attempts: 2,
      backoff: { type: "exponential", delay: 2000 },
      jobId: `${data.executionId}:reply`,
    });
    return true;
  } catch (err) {
    markRedisDown();
    console.error(
      "[agent-engine-queue] enqueue failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function processAgentEngineJob(
  data: AgentEngineQueueJobData,
  log: FastifyBaseLogger,
): Promise<void> {
  const exLog = await attachAutomationExecutionLog({
    executionId: data.executionId,
    organizationId: data.organizationId,
    log,
  });
  if (!exLog) {
    throw new Error(`execution_not_found:${data.executionId}`);
  }

  exLog.info(
    { id: "agent_engine_queue", name: "Agent Engine Queue" },
    "Processando resposta enfileirada (BullMQ)",
    { input: { executionId: data.executionId, messageId: data.messageId } },
  );

  const [bot, conversation, message, contact] = await Promise.all([
    prisma.bot.findFirst({ where: { id: data.botId, organizationId: data.organizationId } }),
    prisma.conversation.findFirst({
      where: { id: data.conversationId, organizationId: data.organizationId },
    }),
    prisma.message.findFirst({ where: { id: data.messageId } }),
    prisma.contact.findFirst({ where: { id: data.contactId, organizationId: data.organizationId } }),
  ]);

  if (!bot || !conversation || !message || !contact) {
    throw new Error("agent_engine_queue_missing_entities");
  }

  await runNativeAgentReplyAndDeliver({
    organizationId: data.organizationId,
    bot,
    conversation,
    contact,
    message,
    log,
    exLog,
  });
}

function registerWorker(app: FastifyInstance): void {
  if (worker || !connection) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<AgentEngineQueueJobData>) => {
      await processAgentEngineJob(job.data, app.log);
    },
    { connection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    app.log.warn({ err, jobId: job?.id }, "agent engine queue job failed");
  });
}

export async function initAgentEngineQueue(app: FastifyInstance): Promise<void> {
  const url = getRedisUrl();
  if (!url) {
    app.log.info("agent engine queue skipped (no REDIS_URL)");
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
      app.log.warn({ err: err.message }, "agent engine queue redis error");
    });

    registerWorker(app);
    redisQueueOperational = true;
    app.log.info("agent engine queue ready");
  } catch (err) {
    markRedisDown();
    app.log.warn(
      { err: err instanceof Error ? err.message : err },
      "agent engine queue init failed — sync fallback",
    );
  }
}

export async function closeAgentEngineQueue(): Promise<void> {
  redisQueueOperational = false;
  await worker?.close().catch(() => {});
  await queue?.close().catch(() => {});
  connection?.disconnect();
  worker = null;
  queue = null;
  connection = null;
}
