export type AutomationCustomToolRow = {
  id: string;
  name: string;
  description: string;
  toolType: string;
  isActive: boolean;
  botId: string | null;
  config?: Record<string, unknown>;
  lastExecutedAt?: string | null;
  executionCount?: number;
  avgDurationMs?: number | null;
  tags?: string[];
};

export type ToolPresetMeta = {
  presetKey: string;
  category: string;
  name: string;
  description: string;
  toolType: string;
  parametersSchema: Record<string, unknown>;
  marketplace?: {
    category: string;
    icon: string;
    popularity: number;
    accent: string;
  } | null;
};

export type AutomationToolsTranslate = (key: string) => string;
