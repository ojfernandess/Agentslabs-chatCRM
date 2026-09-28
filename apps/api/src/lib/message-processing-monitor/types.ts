export type MessageDirection = "INBOUND" | "OUTBOUND";

export type MessageProcessingStage =
  | "webhook_received"
  | "payload_validated"
  | "org_resolved"
  | "inbox_resolved"
  | "contact"
  | "conversation"
  | "persist"
  | "realtime"
  | "transcription"
  | "timeline"
  | "auto_tags"
  | "bot_dispatch"
  | "automation"
  | "meta_send"
  | "rag"
  | "queue"
  | "other";

export type ResourceSnapshot = {
  at: string;
  processCpuPercent: number;
  serverCpuPercent: number | null;
  processMemoryMb: number;
  serverMemoryUsedMb: number | null;
  serverMemoryTotalMb: number | null;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  eventLoopLagMs: number;
  eventLoopUtilization: number | null;
};

export type TraceSpan = {
  stage: MessageProcessingStage | string;
  label: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  cpuDeltaPercent: number;
  meta?: Record<string, string | number | boolean | null>;
};

export type TraceQueryStat = {
  model: string;
  action: string;
  durationMs: number;
  at: string;
};

export type TraceEventCounter = {
  name: string;
  count: number;
  firstAt: string;
  lastAt: string;
};

export type TraceAnomaly = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  at: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type MessageProcessingTrace = {
  traceId: string;
  environment: string;
  direction: MessageDirection;
  organizationId: string;
  organizationName?: string;
  inboxId?: string;
  inboxName?: string;
  provider?: string;
  conversationId?: string;
  messageId?: string;
  providerMessageId?: string;
  messageType?: string;
  bodyLength?: number;
  status: "processing" | "completed" | "error";
  errorMessage?: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs?: number;
  snapshots: {
    before: ResourceSnapshot;
    peak: ResourceSnapshot;
    after?: ResourceSnapshot;
  };
  spans: TraceSpan[];
  queries: TraceQueryStat[];
  querySummary: {
    total: number;
    totalDurationMs: number;
    slowestMs: number;
    repeatedPatterns: Array<{ pattern: string; count: number }>;
  };
  events: TraceEventCounter[];
  realtime: {
    emits: number;
    recipients: number;
    payloadBytes: number;
  };
  bot: {
    triggered: boolean;
    durationMs?: number;
    toolCalls?: number;
  };
  meta: {
    sendAttempts: number;
    lastError?: string;
    lastHttpStatus?: number;
    wamid?: string;
  };
  anomalies: TraceAnomaly[];
  counters: Record<string, number>;
};

export type MonitorSession = {
  active: boolean;
  passiveMode: boolean;
  organizationId: string | null;
  inboxId: string | null;
  direction: "ALL" | MessageDirection;
  samplingPercent: number;
  investigationUntil: string | null;
  slowQueryThresholdMs: number;
  thresholds: {
    processCpuPercent: number;
    serverCpuPercent: number;
    eventLoopLagMs: number;
    messageDurationMs: number;
    queriesPerMessage: number;
    eventsPerMessage: number;
  };
  startedAt: string | null;
  startedByUserId: string | null;
};

export type MonitorOverview = {
  environment: string;
  session: MonitorSession;
  system: ResourceSnapshot & {
    cpuCores: number;
    processingNow: number;
    messagesMonitored: number;
    errors: number;
    peakProcessCpuPercent: number;
    peakEventLoopLagMs: number;
  };
};
