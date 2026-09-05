import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { IntelligentTaggingGraphState } from "./types.js";

let runIntelligentTaggingGraph: typeof import("./graph.js").runIntelligentTaggingGraph;

before(async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/openconduit_test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-for-intelligent-tagging";
  ({ runIntelligentTaggingGraph } = await import("./graph.js"));
});

const catalog = [
  { id: "tag-support", name: "Suporte", color: "#6366f1" },
  { id: "tag-sales", name: "Vendas", color: "#22c55e" },
  { id: "tag-billing", name: "Faturação", color: "#f59e0b" },
];

const labeledDataset: Array<{
  id: string;
  transcript: string;
  expectedTagIds: string[];
}> = [
  {
    id: "d1",
    transcript: "Cliente: a fatura está errada\nAtendente: vou verificar o pagamento",
    expectedTagIds: ["tag-billing"],
  },
  {
    id: "d2",
    transcript: "Cliente: quero comprar o plano anual\nAtendente: envio a proposta",
    expectedTagIds: ["tag-sales"],
  },
  {
    id: "d3",
    transcript: "Cliente: a app não abre\nAtendente: reinicie o telemóvel",
    expectedTagIds: ["tag-support"],
  },
];

function mockInferForSample(sampleId: string) {
  return async () => {
    const sample = labeledDataset.find((s) => s.id === sampleId)!;
    return {
      classifications: sample.expectedTagIds.map((tagId) => ({
        tagId,
        tagName: catalog.find((c) => c.id === tagId)!.name,
        confidence: 0.92,
        rationale: "mock",
        suggestedNewTag: false,
      })),
      suggestedNewTags: [],
    };
  };
}

function baseState(sampleId: string): IntelligentTaggingGraphState {
  const sample = labeledDataset.find((s) => s.id === sampleId)!;
  return {
    organizationId: "org-1",
    conversationId: `conv-${sampleId}`,
    contactId: "contact-1",
    contactName: "Cliente",
    trigger: "manual",
    minConfidence: 0.85,
    maxTags: 5,
    language: "pt",
    privacyAccepted: true,
    tagCatalog: catalog,
    existingTagNames: [],
    transcript: sample.transcript,
    metadataSummary: "status=OPEN",
    mem0Context: "",
    classifications: [],
    suggestedNewTags: [],
    autoApply: [],
    pendingReview: [],
    autoAppliedTagIds: [],
    startedAtMs: Date.now(),
  };
}

const mockApply = async (state: IntelligentTaggingGraphState) => ({
  runId: "run-test",
  autoAppliedTagIds: state.autoApply.map((c) => c.tagId!).filter(Boolean),
});

describe("intelligent tagging graph (mock infer)", () => {
  it("runs receive → preprocess → infer → validate without error", async () => {
    const inferFn = mockInferForSample("d1");
    const partial = await runIntelligentTaggingGraph(baseState("d1"), {
      inferFn: async (input) => inferFn(input as never),
      applyFn: mockApply,
    });
    assert.equal(partial.error, undefined);
    assert.ok(partial.autoApply.length > 0);
  });
});

describe("labeled dataset classification metrics (mock infer)", () => {
  it("meets precision/recall targets on synthetic dataset", async () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const sample of labeledDataset) {
      const inferFn = mockInferForSample(sample.id);
      const result = await runIntelligentTaggingGraph(baseState(sample.id), {
        inferFn: async (input) => inferFn(input as never),
        applyFn: mockApply,
      });
      const predicted = new Set(result.autoApply.map((c) => c.tagId).filter(Boolean) as string[]);
      const expected = new Set(sample.expectedTagIds);

      for (const id of predicted) {
        if (expected.has(id)) tp += 1;
        else fp += 1;
      }
      for (const id of expected) {
        if (!predicted.has(id)) fn += 1;
      }
    }

    const precision = tp / Math.max(tp + fp, 1);
    const recall = tp / Math.max(tp + fn, 1);

    assert.ok(precision >= 0.85);
    assert.ok(recall >= 0.85);
  });
});
