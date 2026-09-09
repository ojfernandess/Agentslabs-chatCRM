import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDuringConversationTranscript,
  filterAlreadyAppliedTags,
  normalizeConfidence,
  parseLlmTaggingResponse,
  splitByConfidence,
} from "./helpers.js";

describe("intelligent-tagging helpers", () => {
  const catalog = [
    { id: "t1", name: "Suporte" },
    { id: "t2", name: "Vendas" },
  ];

  it("splitByConfidence separates auto-apply vs review at threshold", () => {
    const rows = [
      { tagId: "t1", tagName: "Suporte", confidence: 0.92, rationale: "", suggestedNewTag: false },
      { tagId: "t2", tagName: "Vendas", confidence: 0.7, rationale: "", suggestedNewTag: false },
      { tagId: null, tagName: "Nova", confidence: 0.99, rationale: "", suggestedNewTag: true },
    ];
    const { autoApply, pendingReview } = splitByConfidence(rows, 0.85);
    assert.equal(autoApply.length, 1);
    assert.equal(autoApply[0]?.tagId, "t1");
    assert.equal(pendingReview.length, 2);
  });

  it("parseLlmTaggingResponse maps catalog tags and suggested new tags", () => {
    const parsed = parseLlmTaggingResponse(
      {
        tags: [
          { tagId: "t2", tagName: "Vendas", confidence: 0.9, rationale: "pedido comercial" },
          { tagName: "Urgente novo", confidence: 0.88, suggestedNewTag: true },
        ],
        suggestedNewTags: ["Urgente novo"],
      },
      catalog,
    );
    assert.equal(parsed.classifications[0]?.tagId, "t2");
    assert.ok(parsed.suggestedNewTags.includes("Urgente novo"));
  });

  it("normalizeConfidence clamps invalid values", () => {
    assert.equal(normalizeConfidence(1.5), 1);
    assert.equal(normalizeConfidence(-0.2), 0);
    assert.equal(normalizeConfidence("0.75"), 0.75);
    assert.equal(normalizeConfidence("x"), 0);
  });

  it("buildDuringConversationTranscript focuses on trigger inbound block", () => {
    const transcript = buildDuringConversationTranscript(
      [
        { id: "m1", direction: "INBOUND", body: "preciso de fatura antiga", isPrivate: false },
        { id: "m2", direction: "OUTBOUND", body: "como posso ajudar?", isPrivate: false },
        { id: "m3", direction: "INBOUND", body: "quero cancelar o plano", isPrivate: false },
      ],
      "m3",
    );
    assert.match(transcript, /mensagem actual.*cancelar o plano/i);
    assert.doesNotMatch(transcript, /fatura antiga/i);
  });

  it("filterAlreadyAppliedTags removes tags already on contact", () => {
    const filtered = filterAlreadyAppliedTags(
      [
        { tagId: "t1", tagName: "Suporte", confidence: 0.95, rationale: "", suggestedNewTag: false },
        { tagId: "t2", tagName: "Vendas", confidence: 0.95, rationale: "", suggestedNewTag: false },
      ],
      ["Suporte"],
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.tagName, "Vendas");
  });
});
