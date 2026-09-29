import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { recordPrismaQuery } from "./lib/message-processing-monitor/service.js";
import { recordLatencySample } from "./lib/platform-observability/latencySampler.js";
import { resolvePrismaDatasourceUrl } from "./lib/prismaDatasourceUrl.js";

const basePrisma = new PrismaClient({
  datasources: {
    db: { url: resolvePrismaDatasourceUrl() },
  },
  log:
    process.env.NODE_ENV === "development"
      ? ["warn", "error"]
      : ["error"],
});

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        const result = await query(args);
        const durationMs = performance.now() - start;
        recordPrismaQuery(model, operation, durationMs);
        recordLatencySample("prisma_query", durationMs);
        return result;
      },
    },
  },
}) as unknown as PrismaClient;

export async function disconnectDb(): Promise<void> {
  await basePrisma.$disconnect();
}
