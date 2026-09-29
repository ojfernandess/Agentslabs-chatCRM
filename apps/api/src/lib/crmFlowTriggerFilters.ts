import type { Prisma } from "@prisma/client";
import type { CrmFlowContext } from "./crmFlowContext.js";

export type CrmFlowTriggerConfig = {
  type?: string;
  inboxId?: string;
  pipelineStageId?: string;
  tagId?: string;
  channel?: string;
  userId?: string;
  /** Horas sem resposta do cliente (trigger contact_no_reply). */
  noReplyHours?: number;
};

export function crmFlowTriggerMatches(
  config: CrmFlowTriggerConfig | null | undefined,
  triggerType: string,
  payload: CrmFlowContext,
): boolean {
  const configured = config?.type ?? "lead_created";
  if (configured !== triggerType) return false;

  if (config?.inboxId && payload.inboxId !== config.inboxId) return false;
  if (config?.pipelineStageId && payload.pipelineStageId !== config.pipelineStageId) return false;
  if (config?.channel) {
    const ch = String(payload.channel ?? payload.canal ?? "").toUpperCase();
    if (ch !== String(config.channel).toUpperCase()) return false;
  }
  if (config?.userId && payload.assignedToId !== config.userId && payload.userId !== config.userId) {
    return false;
  }
  if (config?.tagId) {
    const tagIds = payload.tagIds;
    if (!Array.isArray(tagIds) || !tagIds.includes(config.tagId)) return false;
  }

  return true;
}

/**
 * Filtro no DB para `dispatchCrmFlowTrigger` — evita carregar todos os fluxos ACTIVE.
 * `lead_created` mantém OR legado (type ausente ou explícito).
 */
export function buildCrmFlowDispatchWhere(
  organizationId: string,
  triggerType: string,
): Prisma.CrmFlowWhereInput {
  const base: Prisma.CrmFlowWhereInput = {
    organizationId,
    status: "ACTIVE",
    isPublished: true,
  };

  if (triggerType === "lead_created") {
    return {
      ...base,
      OR: [
        { triggerConfig: { path: ["type"], equals: "lead_created" } },
        { triggerConfig: { equals: {} } },
      ],
    };
  }

  return {
    ...base,
    triggerConfig: {
      path: ["type"],
      equals: triggerType,
    },
  };
}
