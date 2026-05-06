import type { DealStatus, LeadValueRollup, Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

export function dealStatusFromLeadValueRollup(rollup: LeadValueRollup | null | undefined): DealStatus {
  if (rollup === "WON") return "WON";
  if (rollup === "LOST") return "LOST";
  return "OPEN";
}

/** Atualiza todos os negócios ligados à contacto primária para a etapa actual do funil (alinha pipeline do negócio). */
export async function syncDealsForContactPipelineStage(
  db: Db,
  organizationId: string,
  contactId: string,
  pipelineStageId: string | null,
): Promise<void> {
  if (!pipelineStageId) return;

  const stage = await db.pipelineStage.findFirst({
    where: {
      id: pipelineStageId,
      pipeline: { organizationId },
    },
    include: { leadType: { select: { valueRollup: true } } },
  });
  if (!stage) return;

  const status = dealStatusFromLeadValueRollup(stage.leadType?.valueRollup);

  const deals = await db.deal.findMany({
    where: { organizationId, primaryContactId: contactId },
    select: { id: true },
  });

  for (const d of deals) {
    await db.deal.update({
      where: { id: d.id },
      data: {
        pipeline: { connect: { id: stage.pipelineId } },
        stage: { connect: { id: stage.id } },
        status,
        probabilityPct: stage.probabilityPct,
      },
    });
  }
}
