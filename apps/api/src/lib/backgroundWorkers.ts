import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import {
  runsAgentEngineWorker,
  runsGeneralQueueWorkers,
  type ProcessRole,
} from "./processRole.js";
import {
  flushAutomationLogBuffer,
  registerAutomationExecutionLogWorker,
} from "./automationExecutionLog.js";
import { initBroadcastQueue, closeBroadcastQueue } from "./broadcastQueue.js";
import { initCrmFlowQueue, closeCrmFlowQueue } from "./crmFlowQueue.js";
import { closeAgentEngineQueue, initAgentEngineQueue } from "./agent-engine/queue/agentEngineQueue.js";
import { closeMetaInboundQueue, initMetaInboundQueue } from "./metaInboundQueue.js";
import {
  initRedisLangGraphCheckpointer,
  closeRedisLangGraphCheckpointer,
} from "./agent-engine/checkpoint/RedisLangGraphCheckpointer.js";
import { runCrmFlowNoReplyScannerTick } from "./crmFlowNoReplyScanner.js";
import { runBroadcastSchedulerTick } from "./broadcastScheduler.js";
import { runLeadFinderSchedulerTick } from "./leadFinderScheduler.js";
import { runChatbotFlowSchedulerTick } from "./chatbotFlowScheduler.js";
import { sweepStalePresenceSessions } from "./presenceService.js";
import { runCrmFlowSchedulerTick } from "./crmFlowScheduler.js";
import { runConversationMediaRetentionTick } from "./conversationMediaRetentionJob.js";
import { runWavoipStatusSyncTick } from "./wavoipStatusSyncJob.js";
import { runNvoipHistorySyncTick } from "./nvoipHistorySyncJob.js";
import { runInboxEmailSyncTick } from "./inboxEmailSyncJob.js";
import { runNvoipTokenRefreshTick } from "./nvoipTokenRefreshJob.js";
import { runAutoResolveInactiveConversationsTick } from "./autoResolveInactiveConversations.js";
import { runAnnouncementSchedulerTick } from "./announcements/announcementScheduler.js";
import { ensureWavoipVoiceEnabledForOrgsWithDevices } from "./featureFlags.js";
import { getAgentEngineQueueDiagnostics } from "./agent-engine/queue/agentEngineQueue.js";
import { getPlatformHealthExtension } from "./platform-observability/platformDashboard.js";
import { isBroadcastQueueAvailable } from "./broadcastQueue.js";
import { isCrmFlowQueueAvailable } from "./crmFlowQueue.js";

export type QueueInfrastructureOptions = {
  registerWorkers?: boolean;
  registerAgentEngineWorker?: boolean;
  registerGeneralWorkers?: boolean;
  /** Purge de logs antigos — só no processo worker (evita duplicar em api+worker). */
  purgeAutomationLogs?: boolean;
};

export function resolveQueueInfrastructureFlags(
  role: ProcessRole,
  overrides: QueueInfrastructureOptions = {},
): {
  registerAgentEngineWorker: boolean;
  registerGeneralWorkers: boolean;
  purgeAutomationLogs: boolean;
} {
  const registerWorkers =
    overrides.registerWorkers ?? (runsGeneralQueueWorkers(role) || runsAgentEngineWorker(role));
  return {
    registerAgentEngineWorker:
      overrides.registerAgentEngineWorker ?? (registerWorkers && runsAgentEngineWorker(role)),
    registerGeneralWorkers:
      overrides.registerGeneralWorkers ?? (registerWorkers && runsGeneralQueueWorkers(role)),
    purgeAutomationLogs:
      overrides.purgeAutomationLogs ??
      (overrides.registerGeneralWorkers ?? runsGeneralQueueWorkers(role)),
  };
}

export async function initQueueInfrastructure(
  app: FastifyInstance,
  options: QueueInfrastructureOptions & { processRole?: ProcessRole } = {},
): Promise<void> {
  const role = options.processRole ?? config.processRole;
  const flags = resolveQueueInfrastructureFlags(role, options);

  if (flags.registerAgentEngineWorker || flags.registerGeneralWorkers) {
    registerAutomationExecutionLogWorker(app.log, { purge: flags.purgeAutomationLogs });
  }
  await initBroadcastQueue(app, { registerWorker: flags.registerGeneralWorkers });
  await initCrmFlowQueue(app, { registerWorker: flags.registerGeneralWorkers });
  await initAgentEngineQueue(app, { registerWorker: flags.registerAgentEngineWorker });
  await initMetaInboundQueue(app, { registerWorker: flags.registerGeneralWorkers });
  await initRedisLangGraphCheckpointer(app.log);
}

export function startBackgroundSchedulers(app: FastifyInstance): void {
  const autoResolveMs = 120_000;
  setInterval(() => {
    void runAutoResolveInactiveConversationsTick({ log: app.log });
  }, autoResolveMs);
  void runAutoResolveInactiveConversationsTick({ log: app.log });

  const broadcastSchedulerMs = 60_000;
  setInterval(() => {
    void runBroadcastSchedulerTick(app);
  }, broadcastSchedulerMs);
  void runBroadcastSchedulerTick(app);

  setInterval(() => {
    void runAnnouncementSchedulerTick(app.log);
  }, broadcastSchedulerMs);
  void runAnnouncementSchedulerTick(app.log);

  setInterval(() => {
    void runLeadFinderSchedulerTick(app);
  }, broadcastSchedulerMs);
  void runLeadFinderSchedulerTick(app);

  const chatbotSchedulerMs = 30_000;
  setInterval(() => {
    void runChatbotFlowSchedulerTick(app);
  }, chatbotSchedulerMs);
  void runChatbotFlowSchedulerTick(app);

  setInterval(() => {
    void runCrmFlowSchedulerTick(app);
  }, chatbotSchedulerMs);
  void runCrmFlowSchedulerTick(app);

  const crmNoReplyMs = 5 * 60 * 1000;
  setInterval(() => {
    void runCrmFlowNoReplyScannerTick(app);
  }, crmNoReplyMs);
  void runCrmFlowNoReplyScannerTick(app);

  const mediaRetentionMs = 60 * 60 * 1000;
  setInterval(() => {
    void runConversationMediaRetentionTick({ log: app.log });
  }, mediaRetentionMs);
  void runConversationMediaRetentionTick({ log: app.log });

  const wavoipStatusSyncMs = 5 * 60 * 1000;
  setInterval(() => {
    void runWavoipStatusSyncTick(app.log);
  }, wavoipStatusSyncMs);
  void runWavoipStatusSyncTick(app.log);

  const nvoipHistorySyncMs = 90_000;
  setInterval(() => {
    void runNvoipHistorySyncTick(app.log);
  }, nvoipHistorySyncMs);
  void runNvoipHistorySyncTick(app.log);

  const emailImapSyncMs = 60_000;
  setInterval(() => {
    void runInboxEmailSyncTick(app.log);
  }, emailImapSyncMs);
  void runInboxEmailSyncTick(app.log);

  const nvoipTokenRefreshMs = 10 * 60 * 1000;
  setInterval(() => {
    void runNvoipTokenRefreshTick(app.log);
  }, nvoipTokenRefreshMs);
  void runNvoipTokenRefreshTick(app.log);

  void ensureWavoipVoiceEnabledForOrgsWithDevices().then((count) => {
    if (count > 0) {
      app.log.info({ count }, "Enabled wavoip_voice for organizations with existing Wavoip devices");
    }
  });
}

export function startPresenceSweep(app: FastifyInstance): void {
  const presenceSweepMs = 30_000;
  setInterval(() => {
    void sweepStalePresenceSessions().catch((err) => {
      app.log.error({ err }, "presence sweep failed");
    });
  }, presenceSweepMs);
  void sweepStalePresenceSessions().catch((err) => {
    app.log.error({ err }, "presence sweep failed");
  });
}

export async function shutdownQueueInfrastructure(): Promise<void> {
  await flushAutomationLogBuffer().catch(() => {});
  await closeBroadcastQueue().catch(() => {});
  await closeCrmFlowQueue().catch(() => {});
  await closeAgentEngineQueue().catch(() => {});
  await closeMetaInboundQueue().catch(() => {});
  await closeRedisLangGraphCheckpointer().catch(() => {});
}

export function workerHealthPayload(role: ProcessRole = config.processRole): Record<string, unknown> {
  const observability = getPlatformHealthExtension();
  return {
    status: observability.status === "degraded" ? "degraded" : "ok",
    role,
    version: process.env.APP_VERSION ?? "0.1.0",
    observability,
    queues: {
      agentEngine: getAgentEngineQueueDiagnostics(),
      broadcastOperational: isBroadcastQueueAvailable(),
      crmFlowOperational: isCrmFlowQueueAvailable(),
    },
  };
}
