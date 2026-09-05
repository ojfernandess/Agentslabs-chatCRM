export const DEFAULT_MIN_CONFIDENCE = 0.85;
export const DEFAULT_MAX_TAGS = 5;

export type TagCatalogEntry = {
  id: string;
  name: string;
  color: string;
};

export type TagClassification = {
  tagId: string | null;
  tagName: string;
  confidence: number;
  rationale: string;
  suggestedNewTag: boolean;
};

export type IntelligentTaggingTrigger = "manual" | "on_resolve";

export type IntelligentTaggingGraphState = {
  organizationId: string;
  conversationId: string;
  contactId: string;
  contactName: string;
  trigger: IntelligentTaggingTrigger;
  initiatedByUserId?: string;
  /** Config */
  minConfidence: number;
  maxTags: number;
  language: string;
  privacyAccepted: boolean;
  /** Loaded data */
  tagCatalog: TagCatalogEntry[];
  existingTagNames: string[];
  transcript: string;
  metadataSummary: string;
  mem0Context: string;
  /** Inference */
  classifications: TagClassification[];
  suggestedNewTags: string[];
  /** After validation */
  autoApply: TagClassification[];
  pendingReview: TagClassification[];
  /** Results */
  runId?: string;
  autoAppliedTagIds: string[];
  error?: string;
  startedAtMs: number;
  modelUsed?: string;
};

export type LlmTaggingResult = {
  classifications: TagClassification[];
  suggestedNewTags: string[];
};

export type InferTagsFn = (input: {
  contactName: string;
  transcript: string;
  metadataSummary: string;
  mem0Context: string;
  tagCatalog: TagCatalogEntry[];
  maxTags: number;
  language: string;
}) => Promise<LlmTaggingResult>;
