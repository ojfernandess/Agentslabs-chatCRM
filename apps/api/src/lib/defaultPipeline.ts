import type { Prisma, PrismaClient } from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export async function getOrCreateDefaultPipeline(db: DbClient, organizationId: string) {
  let p = await db.pipeline.findFirst({ where: { organizationId, isDefault: true } });
  if (!p) {
    p = await db.pipeline.create({
      data: { organizationId, name: "Pipeline principal", isDefault: true, sortOrder: 0 },
    });
  }
  return p;
}
