import type { FastifyBaseLogger } from "fastify";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { dispatchCrmFlowTrigger } from "./crmFlowExecutor.js";
import { enqueueCrmFlowTriggerJob, isCrmFlowQueueAvailable } from "./crmFlowQueue.js";
import { broadcastToOrganization } from "./workspaceHub.js";

const recentDedupe = new Map<string, number>();
const DEDUPE_MS = 15_000;

function dedupeKey(organizationId: string, triggerType: string, payload: Record<string, unknown>): string {
  const parts = [
    organizationId,
    triggerType,
    payload.contactId ?? "",
    payload.conversationId ?? "",
    payload.messageId ?? "",
    payload.dealId ?? "",
    payload.callLogId ?? "",
    payload.reminderId ?? "",
  ];
  return parts.join("|");
}

function shouldSkipDedupe(key: string): boolean {
  const now = Date.now();
  const prev = recentDedupe.get(key);
  if (prev != null && now - prev < DEDUPE_MS) return true;
  recentDedupe.set(key, now);
  if (recentDedupe.size > 5000) {
    for (const [k, t] of recentDedupe) {
      if (now - t > DEDUPE_MS) recentDedupe.delete(k);
    }
  }
  return false;
}

/** Dispara fluxos CRM ativos em background (não bloqueia HTTP/webhooks). */
export function fireCrmFlowTriggers(
  organizationId: string,
  triggerType: string,
  payload: Record<string, unknown>,
  log?: FastifyBaseLogger,
): void {
  const key = dedupeKey(organizationId, triggerType, payload);
  if (shouldSkipDedupe(key)) return;

  void (async () => {
    const enabled = await isOrganizationFeatureEnabled(organizationId, "crm_flows");
    if (!enabled) return;

    if (isCrmFlowQueueAvailable()) {
      const queued = await enqueueCrmFlowTriggerJob({
        organizationId,
        triggerType,
        payload,
      });
      if (queued) return;
    }

    await dispatchCrmFlowTrigger({
      organizationId,
      triggerType,
      payload,
      log,
    });
  })().catch((err) => {
    log?.warn({ err, triggerType, organizationId }, "crm flow triggers failed");
  });
}

export function broadcastCrmFlowExecutionUpdated(
  organizationId: string,
  executionId: string,
  crmFlowId: string,
  status: string,
): void {
  broadcastToOrganization(organizationId, {
    type: "crm_flow.execution.updated",
    executionId,
    crmFlowId,
    status,
  });
}

/** Mapeia eventos de broadcast legados para triggers CRM. */
export const BROADCAST_TO_CRM_TRIGGER: Record<string, string> = {
  NEW_LEAD: "lead_created",
  DEAL_STAGE_CHANGED: "pipeline_stage_changed",
  TAG_ADDED: "lead_updated",
  DEAL_WON: "deal_won",
  DEAL_LOST: "deal_lost",
};

export function fireCrmFlowFromBroadcastEvent(
  organizationId: string,
  broadcastTrigger: string,
  payload: Record<string, unknown>,
  log?: FastifyBaseLogger,
): void {
  const mapped = BROADCAST_TO_CRM_TRIGGER[broadcastTrigger];
  if (!mapped) return;
  fireCrmFlowTriggers(organizationId, mapped, payload, log);
}
