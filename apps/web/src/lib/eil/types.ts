export type AgentEilPolicyDraft = {
  id: string;
  action?: string;
  requires?: Array<{ fact: string; op: string; value?: unknown }>;
  forbids?: Array<{ fact: string; op: string; value?: unknown }>;
  blockWhenUnmet?: boolean;
  name?: string;
  description?: string;
  instruction?: string;
  active?: boolean;
  onUnknown?: "fetch" | "ask" | "block" | "ignore";
  onViolation?: "block" | "guide" | "escalate" | "alert" | "warn";
  idManuallyEdited?: boolean;
};

export type AgentEilConfigDraft = {
  enabled?: boolean;
  policies?: AgentEilPolicyDraft[];
};
