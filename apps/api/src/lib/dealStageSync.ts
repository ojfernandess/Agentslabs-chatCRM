import type { DealStatus, LeadValueRollup, Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

export function dealStatusFromLeadValueRollup(rollup: LeadValueRollup | null | undefined): DealStatus {
  if (rollup === "WON") return "WON";
  if (rollup === "LOST") return "LOST";
  return "OPEN";
}

/** Atualiza negócios cuja contacto primária mudou de etapa no funil (mesmo pipeline). */
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
      pipeline: { organizationId, isDefault: true },
    },
    include: { leadType: { select: { valueRollup: true } } },
  });
  if (!stage) return;

  const status = dealStatusFromLeadValueRollup(stage.leadType?.valueRollup);

  await db.deal.updateMany({
    where: {
      organizationId,
      primaryContactId: contactId,
      pipelineId: stage.pipelineId,
    },
    data: {
      stageId: stage.id,
      status,
      probabilityPct: stage.probabilityPct,
    },
  });
}
