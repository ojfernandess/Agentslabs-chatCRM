export type ExecutionQualitySignalKind =
  | "lost_context"
  | "possible_hallucination"
  | "tool_not_answered"
  | "tool_ignored"
  | "conversation_loop"
  | "supervisor_warning";

export type ExecutionQualitySignal = {
  id: string;
  kind: ExecutionQualitySignalKind;
  severity: "warn" | "error";
  title: string;
  detail: string;
  toolName?: string;
  toolPreview?: string;
  replyPreview?: string;
  suggestedActions?: Array<"send_now" | "ignore" | "retry">;
};

export type ExecutionFlowNodeKind =
  | "message"
  | "agent"
  | "condition"
  | "tool"
  | "response"
  | "supervisor"
  | "quality";

export type ExecutionFlowNode = {
  id: string;
  kind: ExecutionFlowNodeKind;
  label: string;
  sequence: number;
  level?: string;
  meta?: Record<string, unknown>;
};

export type ExecutionFlowEdge = {
  from: string;
  to: string;
};

export type ExecutionFlowGraph = {
  nodes: ExecutionFlowNode[];
  edges: ExecutionFlowEdge[];
};
