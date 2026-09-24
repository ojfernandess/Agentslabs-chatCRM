import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDuringConversationTranscript,
  enrichTagCatalogForLlm,
  extractCurrentCustomerMessage,
  filterAlreadyAppliedTags,
  filterClassificationsByMessageEvidence,
  inferTagUsageHint,
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
    assert.equal(extractCurrentCustomerMessage(transcript).toLowerCase(), "quero cancelar o plano");
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

  it("extractCurrentCustomerMessage reads marked current lines", () => {
    const msg = extractCurrentCustomerMessage(
      "Cliente (mensagem actual — classificar SÓ com base nisto): quero uma cotação para 10 unidades",
    );
    assert.match(msg, /cotação/i);
  });

  it("filterClassificationsByMessageEvidence rejects mismatched intent", () => {
    const catalog = [
      { id: "t1", name: "Reclamação" },
      { id: "t2", name: "Cotação" },
    ];
    const kept = filterClassificationsByMessageEvidence(
      [
        {
          tagId: "t2",
          tagName: "Cotação",
          confidence: 0.95,
          rationale: "pediu cotação de 10 unidades",
          suggestedNewTag: false,
        },
        {
          tagId: "t1",
          tagName: "Reclamação",
          confidence: 0.95,
          rationale: "cliente insatisfeito",
          suggestedNewTag: false,
        },
      ],
      "quero uma cotação para 10 unidades",
      catalog,
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.tagName, "Cotação");
  });

  it("enrichTagCatalogForLlm adds semantic hints from tag names", () => {
    const rows = enrichTagCatalogForLlm([{ id: "t1", name: "Cotação" }]);
    assert.match(rows[0]?.hint ?? "", /orçamento|cotação/i);
    assert.equal(inferTagUsageHint("Dúvidas").length > 10, true);
  });
});
