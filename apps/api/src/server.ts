import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { prisma, disconnectDb } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { contactRoutes } from "./routes/contacts.js";
import { messageRoutes } from "./routes/messages.js";
import { tagRoutes } from "./routes/tags.js";
import { pipelineRoutes } from "./routes/pipeline.js";
import { reminderRoutes } from "./routes/reminders.js";
import { templateRoutes } from "./routes/templates.js";
import { slaPolicyRoutes } from "./routes/slaPolicies.js";
import { cannedResponseRoutes } from "./routes/cannedResponses.js";
import { settingsRoutes } from "./routes/settings.js";
import { userRoutes } from "./routes/users.js";
import { userInvitationRoutes } from "./routes/userInvitations.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { wavoipIntegrationRoutes } from "./routes/wavoipIntegration.js";
import { wavoipVoiceRoutes } from "./routes/wavoipVoice.js";
import { threecxIntegrationRoutes } from "./routes/threecxIntegration.js";
import { threecxVoiceRoutes } from "./routes/threecxVoice.js";
import { threeCxCrmRoutes } from "./lib/threeCxCrm.js";
import { nvoipIntegrationRoutes } from "./routes/nvoipIntegration.js";
import { nvoipVoiceRoutes } from "./routes/nvoipVoice.js";
import { nvoipWebSdkRoutes } from "./routes/nvoipWebSdk.js";
import { nvoipContactMessagingRoutes } from "./routes/nvoipContactMessaging.js";
import { nvoipSecurityRoutes } from "./routes/nvoipSecurity.js";
import { nvoipWhatsappRoutes } from "./routes/nvoipWhatsapp.js";
import { conversationRoutes } from "./routes/conversations.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { reportsRoutes } from "./routes/reports.js";
import { leadTypeRoutes } from "./routes/leadTypes.js";
import { superRoutes } from "./routes/super.js";
import { platformRoutes } from "./routes/platform.js";
import { crmRoutes } from "./routes/crm.js";
import { teamRoutes } from "./routes/teams.js";
import { agentBotInboxRoutes } from "./routes/agentBotInbox.js";
import { botRoutes } from "./routes/bots.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { publicMessageMediaRoutes } from "./routes/publicMessageMedia.js";
import { widgetPublicRoutes } from "./routes/widgetPublic.js";
import { publicCsatRoutes } from "./routes/publicCsat.js";
import { broadcastRoutes } from "./routes/broadcasts.js";
import { leadFinderRoutes } from "./routes/leadFinder.js";
import { inboxRoutes } from "./routes/inboxes.js";
import { channelInboxPublicRoutes } from "./routes/channelInboxPublic.js";
import { channelNativePublicRoutes } from "./routes/channelNativePublic.js";
import { publicSystemDocumentationRoutes } from "./routes/publicSystemDocumentation.js";
import { automationRoutes } from "./routes/automations.js";
import { automationSuiteRoutes } from "./routes/automationSuite.js";
import { publicChatbotFlowRoutes } from "./routes/publicChatbotFlowRoutes.js";
import { publicKnowledgeSourcePushRoutes } from "./routes/publicKnowledgeSourcePush.js";
import { runAutoResolveInactiveConversationsTick } from "./lib/autoResolveInactiveConversations.js";
import {
  flushAutomationLogBuffer,
  registerAutomationExecutionLogWorker,
} from "./lib/automationExecutionLog.js";
import { initBroadcastQueue, closeBroadcastQueue } from "./lib/broadcastQueue.js";
import { initCrmFlowQueue, closeCrmFlowQueue } from "./lib/crmFlowQueue.js";
import { runCrmFlowNoReplyScannerTick } from "./lib/crmFlowNoReplyScanner.js";
import { runBroadcastSchedulerTick } from "./lib/broadcastScheduler.js";
import { runLeadFinderSchedulerTick } from "./lib/leadFinderScheduler.js";
import { runChatbotFlowSchedulerTick } from "./lib/chatbotFlowScheduler.js";
import { runCrmFlowSchedulerTick } from "./lib/crmFlowScheduler.js";
import { runConversationMediaRetentionTick } from "./lib/conversationMediaRetentionJob.js";
import { runWavoipStatusSyncTick } from "./lib/wavoipStatusSyncJob.js";
import { runNvoipHistorySyncTick } from "./lib/nvoipHistorySyncJob.js";
import { runNvoipTokenRefreshTick } from "./lib/nvoipTokenRefreshJob.js";
import { ensureWavoipVoiceEnabledForOrgsWithDevices } from "./lib/featureFlags.js";

const app = Fastify({
  logger: {
    level: config.isProduction ? "info" : "debug",
  },
});

app.log.warn(
  {
    agentKbDebug: config.agentKbDebug,
    /** Se false em Docker, confirme que o serviço `api` recebe `AGENT_KB_DEBUG` (env_file / environment). */
    agentKbDebugEnvPresent: Boolean(process.env.AGENT_KB_DEBUG?.trim()),
  },
  "startup_flags",
);

// Security plugins
await app.register(helmet, {
  contentSecurityPolicy: config.isProduction ? undefined : false,
  /** Widget e media publicos sao carregados em sites de terceiros. */
  crossOriginResourcePolicy: { policy: "cross-origin" },
});
await app.register(cors, {
  delegator: (req, callback) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const isPublicEmbed =
      path.startsWith("/api/v1/public/widget/") ||
      path.startsWith("/api/v1/public/channels/") ||
      path.startsWith("/api/v1/public/chatbot/") ||
      path.startsWith("/api/v1/public/csat/") ||
      path.startsWith("/api/v1/public/inbox/");

    if (isPublicEmbed) {
      callback(null, {
        origin: true,
        credentials: false,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      });
      return;
    }

    callback(null, {
      origin: config.isProduction ? config.publicUrl : config.corsOrigin,
      credentials: true,
    });
  },
});
await app.register(rateLimit, {
  max: 400,
  timeWindow: "1 minute",
  /** Evita que vários agentes no mesmo IP (proxy EasyPanel/NAT) partilhem um único limite. */
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.startsWith("Bearer ") && auth.length > 24) {
      return `sess:${auth.slice(7, 64)}`;
    }
    return `ip:${req.ip}`;
  },
  allowList: (req) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    return (
      path.startsWith("/webhooks") ||
      path.startsWith("/health") ||
      path === "/api/v1/auth/me" ||
      path.startsWith("/api/v1/messages/media/") ||
      path.startsWith("/api/v1/ws") ||
      path.startsWith("/api/v1/public/csat/") ||
      path.startsWith("/api/v1/public/inbox/") ||
      path.startsWith("/api/v1/public/channels/") ||
      path.startsWith("/api/v1/public/widget/") ||
      path.startsWith("/api/v1/public/chatbot/") ||
      path.startsWith("/api/v1/public/system-documentation") ||
      path.startsWith("/api/v1/public/knowledge-source-push/")
    );
  },
});
await app.register(multipart, {
  limits: { fileSize: 16 * 1024 * 1024 },
});
await app.register(jwt, {
  secret: config.jwtSecret,
  sign: { expiresIn: config.jwtExpiry },
});

// Decorate with prisma
app.decorate("prisma", prisma);

// Leitura pública de áudio carregado (WhatsApp obtém o ficheiro antes de entregar ao cliente)
await app.register(publicMessageMediaRoutes);
await app.register(widgetPublicRoutes);
await app.register(publicChatbotFlowRoutes);
await app.register(publicSystemDocumentationRoutes, { prefix: "/api/v1/public" });
await app.register(publicCsatRoutes, { prefix: "/api/v1/public/csat" });
await app.register(channelInboxPublicRoutes, { prefix: "/api/v1/public/inbox" });
await app.register(channelNativePublicRoutes, { prefix: "/api/v1/public/channels" });
await app.register(publicKnowledgeSourcePushRoutes, { prefix: "/api/v1/public" });

// Register routes
await app.register(authRoutes, { prefix: "/api/v1/auth" });
await app.register(dashboardRoutes, { prefix: "/api/v1/dashboard" });
await app.register(reportsRoutes, { prefix: "/api/v1/reports" });
await app.register(contactRoutes, { prefix: "/api/v1/contacts" });
await app.register(conversationRoutes, { prefix: "/api/v1/conversations" });
await app.register(messageRoutes, { prefix: "/api/v1/messages" });
await app.register(tagRoutes, { prefix: "/api/v1/tags" });
await app.register(pipelineRoutes, { prefix: "/api/v1/pipeline" });
await app.register(crmRoutes, { prefix: "/api/v1/crm" });
await app.register(leadTypeRoutes, { prefix: "/api/v1/lead-types" });
await app.register(reminderRoutes, { prefix: "/api/v1/reminders" });
await app.register(templateRoutes, { prefix: "/api/v1/templates" });
await app.register(slaPolicyRoutes, { prefix: "/api/v1/sla-policies" });
await app.register(cannedResponseRoutes, { prefix: "/api/v1/canned-responses" });
await app.register(broadcastRoutes, { prefix: "/api/v1/broadcasts" });
await app.register(leadFinderRoutes, { prefix: "/api/v1/lead-finder" });
await app.register(settingsRoutes, { prefix: "/api/v1/settings" });
await app.register(wavoipIntegrationRoutes, { prefix: "/api/v1/settings/wavoip" });
await app.register(wavoipVoiceRoutes, { prefix: "/api/v1/wavoip" });
await app.register(threecxIntegrationRoutes, { prefix: "/api/v1/settings/threecx" });
await app.register(threecxVoiceRoutes, { prefix: "/api/v1/threecx" });
await app.register(threeCxCrmRoutes);
await app.register(nvoipIntegrationRoutes, { prefix: "/api/v1/settings/nvoip" });
await app.register(nvoipVoiceRoutes, { prefix: "/api/v1/nvoip" });
await app.register(nvoipWebSdkRoutes, { prefix: "/api/v1/nvoip/web-sdk" });
await app.register(nvoipContactMessagingRoutes, { prefix: "/api/v1" });
await app.register(nvoipSecurityRoutes, { prefix: "/api/v1/nvoip/security" });
await app.register(nvoipWhatsappRoutes, { prefix: "/api/v1/nvoip/whatsapp" });
await app.register(userRoutes, { prefix: "/api/v1/users" });
await app.register(userInvitationRoutes, { prefix: "/api/v1/users/invites" });
await app.register(inboxRoutes, { prefix: "/api/v1/inboxes" });
await app.register(superRoutes, { prefix: "/api/v1/super" });
await app.register(platformRoutes, { prefix: "/api/v1/platform" });
await app.register(workspaceRoutes, { prefix: "/api/v1" });
await app.register(teamRoutes, { prefix: "/api/v1/teams" });
await app.register(agentBotInboxRoutes, { prefix: "/api/v1/agent-bot" });
await app.register(botRoutes, { prefix: "/api/v1/bots" });
  await app.register(automationRoutes, { prefix: "/api/v1/automations" });
  await app.register(automationSuiteRoutes, { prefix: "/api/v1/automation" });
await app.register(webhookRoutes, { prefix: "/webhooks" });

// Health check
app.get("/health", async () => ({
  status: "ok",
  version: process.env.APP_VERSION ?? "0.1.0",
}));

// Graceful shutdown
const shutdown = async () => {
  app.log.info("Shutting down...");
  await flushAutomationLogBuffer().catch(() => {});
  await closeBroadcastQueue().catch(() => {});
  await closeCrmFlowQueue().catch(() => {});
  await app.close();
  await disconnectDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server running at http://${config.host}:${config.port}`);
  registerAutomationExecutionLogWorker(app.log);
  await initBroadcastQueue(app);
  await initCrmFlowQueue(app);
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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
