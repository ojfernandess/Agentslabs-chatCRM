import { z } from "zod";

export const CRM_FLOW_EXPORT_VERSION = 1;

export const crmFlowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z.record(z.unknown()).optional(),
});

export const crmFlowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  branch: z.string().optional(),
});

export const crmFlowDefinitionSchema = z.object({
  nodes: z.array(crmFlowNodeSchema),
  edges: z.array(crmFlowEdgeSchema),
});

export type CrmFlowDefinition = z.infer<typeof crmFlowDefinitionSchema>;
export type CrmFlowNode = z.infer<typeof crmFlowNodeSchema>;

export function defaultCrmFlowDefinition(triggerType = "lead_created"): CrmFlowDefinition {
  const triggerId = "trigger-1";
  const endId = "end-1";
  return {
    nodes: [
      { id: triggerId, type: "trigger", position: { x: 120, y: 40 }, data: { triggerType } },
      { id: endId, type: "end", position: { x: 120, y: 200 }, data: {} },
    ],
    edges: [{ id: "e1", source: triggerId, target: endId }],
  };
}

export function parseCrmFlowDefinition(raw: unknown): CrmFlowDefinition {
  const parsed = crmFlowDefinitionSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return defaultCrmFlowDefinition();
}

export const CRM_FLOW_TRIGGER_TYPES = [
  "lead_created",
  "lead_updated",
  "lead_converted",
  "lead_lost",
  "deal_created",
  "deal_updated",
  "pipeline_stage_changed",
  "deal_won",
  "deal_lost",
  "conversation_started",
  "message_received",
  "message_sent",
  "conversation_closed",
  "contact_no_reply",
  "call_inbound",
  "call_outbound",
  "call_missed",
  "call_ended",
  "event_created",
  "event_completed",
  "event_cancelled",
  "specific_date",
  "specific_time",
  "after_minutes",
  "after_hours",
  "after_days",
] as const;
