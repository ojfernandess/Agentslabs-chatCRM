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
import { settingsRoutes } from "./routes/settings.js";
import { userRoutes } from "./routes/users.js";
import { webhookRoutes } from "./routes/webhooks.js";
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
import { publicCsatRoutes } from "./routes/publicCsat.js";
import { broadcastRoutes } from "./routes/broadcasts.js";
import { inboxRoutes } from "./routes/inboxes.js";
import { channelInboxPublicRoutes } from "./routes/channelInboxPublic.js";
import { channelNativePublicRoutes } from "./routes/channelNativePublic.js";
import { publicSystemDocumentationRoutes } from "./routes/publicSystemDocumentation.js";
import { automationRoutes } from "./routes/automations.js";
import { runAutoResolveInactiveConversationsTick } from "./lib/autoResolveInactiveConversations.js";

const app = Fastify({
  logger: {
    level: config.isProduction ? "info" : "debug",
  },
});

// Security plugins
await app.register(helmet, {
  contentSecurityPolicy: config.isProduction ? undefined : false,
});
await app.register(cors, {
  origin: config.isProduction ? config.publicUrl : config.corsOrigin,
  credentials: true,
});
await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
      allowList: (req) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        return (
          path.startsWith("/webhooks") ||
          path.startsWith("/api/v1/messages/media/") ||
          path.startsWith("/api/v1/ws") ||
          path.startsWith("/api/v1/public/csat/") ||
          path.startsWith("/api/v1/public/inbox/") ||
          path.startsWith("/api/v1/public/channels/") ||
          path.startsWith("/api/v1/public/system-documentation")
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
await app.register(publicSystemDocumentationRoutes, { prefix: "/api/v1/public" });
await app.register(publicCsatRoutes, { prefix: "/api/v1/public/csat" });
await app.register(channelInboxPublicRoutes, { prefix: "/api/v1/public/inbox" });
await app.register(channelNativePublicRoutes, { prefix: "/api/v1/public/channels" });

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
await app.register(broadcastRoutes, { prefix: "/api/v1/broadcasts" });
await app.register(settingsRoutes, { prefix: "/api/v1/settings" });
await app.register(userRoutes, { prefix: "/api/v1/users" });
await app.register(inboxRoutes, { prefix: "/api/v1/inboxes" });
await app.register(superRoutes, { prefix: "/api/v1/super" });
await app.register(platformRoutes, { prefix: "/api/v1/platform" });
await app.register(workspaceRoutes, { prefix: "/api/v1" });
await app.register(teamRoutes, { prefix: "/api/v1/teams" });
await app.register(agentBotInboxRoutes, { prefix: "/api/v1/agent-bot" });
await app.register(botRoutes, { prefix: "/api/v1/bots" });
await app.register(automationRoutes, { prefix: "/api/v1/automations" });
await app.register(webhookRoutes, { prefix: "/webhooks" });

// Health check
app.get("/health", async () => ({ status: "ok" }));

// Graceful shutdown
const shutdown = async () => {
  app.log.info("Shutting down...");
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
  const autoResolveMs = 120_000;
  setInterval(() => {
    void runAutoResolveInactiveConversationsTick({ log: app.log });
  }, autoResolveMs);
  void runAutoResolveInactiveConversationsTick({ log: app.log });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
