export type CrmFlowNode = {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
};

export type CrmFlowEdge = {
  id: string;
  source: string;
  target: string;
  branch?: string;
};

export type CrmFlowDefinition = {
  nodes: CrmFlowNode[];
  edges: CrmFlowEdge[];
};

export type CrmFlowStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
export type CrmFlowType = "CRM" | "WHATSAPP" | "TELEPHONY" | "AGENDA" | "SYSTEM";

export type CrmFlowRow = {
  id: string;
  name: string;
  description: string | null;
  flowType: CrmFlowType;
  status: CrmFlowStatus;
  isPublished: boolean;
  flowDefinition: CrmFlowDefinition;
  triggerConfig: Record<string, unknown>;
  variables: unknown[];
  lastExecutedAt: string | null;
  executionCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
};

export function defaultCrmFlow(triggerType = "lead_created"): CrmFlowDefinition {
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

export const CRM_BLOCK_GROUPS: { labelKey: string; blocks: { type: string; labelKey: string }[] }[] = [
  {
    labelKey: "crmFlows.blocks.triggers",
    blocks: [
      { type: "trigger", labelKey: "crmFlows.blocks.trigger" },
      { type: "condition", labelKey: "crmFlows.blocks.condition" },
      { type: "wait", labelKey: "crmFlows.blocks.wait" },
    ],
  },
  {
    labelKey: "crmFlows.blocks.crm",
    blocks: [
      { type: "add_tag", labelKey: "crmFlows.blocks.addTag" },
      { type: "move_stage", labelKey: "crmFlows.blocks.moveStage" },
      { type: "assign_user", labelKey: "crmFlows.blocks.assignUser" },
      { type: "distribute_lead", labelKey: "crmFlows.blocks.distributeLead" },
      { type: "create_task", labelKey: "crmFlows.blocks.createTask" },
      { type: "remove_tag", labelKey: "crmFlows.blocks.removeTag" },
    ],
  },
  {
    labelKey: "crmFlows.blocks.channels",
    blocks: [
      { type: "send_whatsapp_text", labelKey: "crmFlows.blocks.sendWhatsapp" },
      { type: "ai_classify", labelKey: "crmFlows.blocks.aiClassify" },
      { type: "end", labelKey: "crmFlows.blocks.end" },
    ],
  },
  {
    labelKey: "crmFlows.blocks.telephony",
    blocks: [
      { type: "create_callback", labelKey: "crmFlows.blocks.createCallback" },
      { type: "make_call", labelKey: "crmFlows.blocks.makeCall" },
      { type: "forward_call", labelKey: "crmFlows.blocks.forwardCall" },
      { type: "create_call_log", labelKey: "crmFlows.blocks.createCallLog" },
    ],
  },
];
