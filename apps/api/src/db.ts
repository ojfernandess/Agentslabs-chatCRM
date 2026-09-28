import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { recordPrismaQuery } from "./lib/message-processing-monitor/service.js";

const basePrisma = new PrismaClient({
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
        recordPrismaQuery(model, operation, performance.now() - start);
        return result;
      },
    },
  },
}) as unknown as PrismaClient;

export async function disconnectDb(): Promise<void> {
  await basePrisma.$disconnect();
}
