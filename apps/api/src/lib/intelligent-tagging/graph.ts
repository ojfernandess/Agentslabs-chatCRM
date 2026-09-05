import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { InferTagsFn, IntelligentTaggingGraphState, TagClassification } from "./types.js";
import { applyAndPersistNode } from "./nodes/applyAndPersist.js";
import { inferNode } from "./nodes/infer.js";
import { preprocessNode, receiveDataNode } from "./nodes/receiveData.js";
import { validateConfidenceNode } from "./nodes/validateConfidence.js";

const TaggingState = Annotation.Root({
  organizationId: Annotation<string>,
  conversationId: Annotation<string>,
  contactId: Annotation<string>,
  contactName: Annotation<string>,
  trigger: Annotation<IntelligentTaggingGraphState["trigger"]>,
  initiatedByUserId: Annotation<string | undefined>,
  minConfidence: Annotation<number>,
  maxTags: Annotation<number>,
  language: Annotation<string>,
  privacyAccepted: Annotation<boolean>,
  tagCatalog: Annotation<IntelligentTaggingGraphState["tagCatalog"]>,
  existingTagNames: Annotation<string[]>,
  transcript: Annotation<string>,
  metadataSummary: Annotation<string>,
  mem0Context: Annotation<string>,
  classifications: Annotation<TagClassification[]>,
  suggestedNewTags: Annotation<string[]>,
  autoApply: Annotation<TagClassification[]>,
  pendingReview: Annotation<TagClassification[]>,
  runId: Annotation<string | undefined>,
  autoAppliedTagIds: Annotation<string[]>,
  error: Annotation<string | undefined>,
  startedAtMs: Annotation<number>,
  modelUsed: Annotation<string | undefined>,
});

export type IntelligentTaggingGraphDeps = {
  inferFn?: InferTagsFn;
  applyFn?: (state: IntelligentTaggingGraphState) => Promise<Partial<IntelligentTaggingGraphState>>;
};

function mergePartial(
  state: IntelligentTaggingGraphState,
  patch: Partial<IntelligentTaggingGraphState>,
): IntelligentTaggingGraphState {
  return { ...state, ...patch };
}

export function buildIntelligentTaggingGraph(deps: IntelligentTaggingGraphDeps = {}) {
  const graph = new StateGraph(TaggingState)
    .addNode("receive_data", async (state) => receiveDataNode(state))
    .addNode("preprocess", async (state) => preprocessNode(state))
    .addNode("infer", async (state) => inferNode(state, deps.inferFn))
    .addNode("validate_confidence", async (state) => validateConfidenceNode(state))
    .addNode("apply_persist", async (state) =>
      deps.applyFn ? deps.applyFn(state) : applyAndPersistNode(state),
    )
    .addEdge(START, "receive_data")
    .addEdge("receive_data", "preprocess")
    .addEdge("preprocess", "infer")
    .addEdge("infer", "validate_confidence")
    .addEdge("validate_confidence", "apply_persist")
    .addEdge("apply_persist", END);

  return graph.compile();
}

export async function runIntelligentTaggingGraph(
  initialState: IntelligentTaggingGraphState,
  deps: IntelligentTaggingGraphDeps = {},
): Promise<IntelligentTaggingGraphState> {
  const app = buildIntelligentTaggingGraph(deps);
  const result = await app.invoke(initialState);
  return mergePartial(initialState, result as Partial<IntelligentTaggingGraphState>);
}
