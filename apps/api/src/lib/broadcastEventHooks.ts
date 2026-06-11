import type { FastifyInstance } from "fastify";
import { triggerEventCampaigns } from "./broadcastScheduler.js";
import { fireCrmFlowFromBroadcastEvent } from "./crmFlowHooks.js";

/** Dispara campanhas EVENT e fluxos CRM em background (não bloqueia a resposta HTTP). */
export function fireBroadcastEventTriggers(
  app: FastifyInstance,
  organizationId: string,
  eventTrigger: string,
  eventPayload: Record<string, unknown>,
): void {
  void triggerEventCampaigns(app, organizationId, eventTrigger, eventPayload).catch((err) => {
    app.log.warn({ err, eventTrigger, organizationId }, "broadcast event triggers failed");
  });
  fireCrmFlowFromBroadcastEvent(organizationId, eventTrigger, eventPayload, app.log);
}
