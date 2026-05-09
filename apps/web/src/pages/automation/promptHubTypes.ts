export type PromptModuleRow = {
  id: string;
  name: string;
  slug: string;
  body: string;
  version: number;
  labels?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

export type PromptStatus = "production" | "test" | "draft" | "active";

export type PromptHistoryEntry = {
  at: string;
  version: number;
  body: string;
};

export type PromptLabels = {
  category?: string;
  tags?: string[];
  status?: PromptStatus;
  modelHint?: string;
  description?: string;
  icon?: string;
  color?: string;
  connectedToolIds?: string[];
  history?: PromptHistoryEntry[];
  analytics?: {
    executions?: number;
    successRate?: number;
    tokens?: number;
    avgMs?: number;
    rating?: number;
  };
  /** Display name persisted on create / first save */
  createdByName?: string;
};
