import Fastify from "fastify";
import { config } from "./config.js";
import { prisma, disconnectDb } from "./db.js";
import { closeAllMcpSessions } from "./lib/mcp/index.js";
import {
  initQueueInfrastructure,
  shutdownQueueInfrastructure,
  startBackgroundSchedulers,
  workerHealthPayload,
} from "./lib/backgroundWorkers.js";
import { initPlatformObservability } from "./lib/platform-observability/init.js";
import {
  runsBackgroundSchedulers,
  runsQueueWorkers,
} from "./lib/processRole.js";

if (!runsQueueWorkers(config.processRole)) {
  console.error(
    `[worker] PROCESS_ROLE=${config.processRole} — use PROCESS_ROLE=worker, agent-worker or all`,
  );
  process.exit(1);
}

const app = Fastify({
  logger: {
    level: config.isProduction ? "info" : "debug",
  },
});

app.decorate("prisma", prisma);

app.log.info({ processRole: config.processRole }, "worker_process_starting");
initPlatformObservability();

app.get("/health", async () => workerHealthPayload(config.processRole));

const shutdown = async () => {
  app.log.info("Worker shutting down...");
  await shutdownQueueInfrastructure();
  await closeAllMcpSessions().catch(() => {});
  await app.close();
  await disconnectDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Worker health at http://${config.host}:${config.port}/health`);

  await initQueueInfrastructure(app, { processRole: config.processRole });
  if (runsBackgroundSchedulers(config.processRole)) {
    startBackgroundSchedulers(app);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
