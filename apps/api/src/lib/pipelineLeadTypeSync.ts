import type { DbClient } from "./defaultPipeline.js";
import { getOrCreateDefaultPipeline } from "./defaultPipeline.js";

export async function ensurePipelineStageForLeadType(
  db: DbClient,
  organizationId: string,
  leadTypeId: string,
) {
  const pipeline = await getOrCreateDefaultPipeline(db, organizationId);
  const existing = await db.pipelineStage.findFirst({
    where: { pipelineId: pipeline.id, leadTypeId },
  });
  if (existing) return existing;

  const lt = await db.leadType.findFirst({
    where: { id: leadTypeId, organizationId },
  });
  if (!lt) {
    throw new Error("Lead type not found");
  }

  const sameNameUnlinked = await db.pipelineStage.findFirst({
    where: {
      pipelineId: pipeline.id,
      name: lt.name,
      leadTypeId: null,
    },
  });
  if (sameNameUnlinked) {
    return db.pipelineStage.update({
      where: { id: sameNameUnlinked.id },
      data: {
        leadTypeId: lt.id,
        color: lt.color,
        order: lt.order,
      },
    });
  }

  return db.pipelineStage.create({
    data: {
      pipelineId: pipeline.id,
      leadTypeId: lt.id,
      name: lt.name,
      color: lt.color,
      order: lt.order,
      probabilityPct: 0,
    },
  });
}

export async function syncPipelineStageFromLeadType(
  db: DbClient,
  organizationId: string,
  leadTypeId: string,
) {
  const pipeline = await getOrCreateDefaultPipeline(db, organizationId);
  const lt = await db.leadType.findFirst({ where: { id: leadTypeId, organizationId } });
  if (!lt) return;
  const res = await db.pipelineStage.updateMany({
    where: { pipelineId: pipeline.id, leadTypeId },
    data: { name: lt.name, color: lt.color, order: lt.order },
  });
  if (res.count === 0) {
    await ensurePipelineStageForLeadType(db, organizationId, leadTypeId);
  }
}
