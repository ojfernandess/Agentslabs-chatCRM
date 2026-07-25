import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQueryEntityRankingBoost,
  extractQueryEstablishmentTokens,
  extractQuerySegmentTokens,
} from "./knowledgeSearchRanking.js";

test("extractQuerySegmentTokens finds product/plan segments", () => {
  const tokens = extractQuerySegmentTokens("qual o preço do plano enterprise?");
  assert.ok(tokens.includes("enterprise"));
});

test("extractQueryEstablishmentTokens finds hotel name in query", () => {
  const tokens = extractQueryEstablishmentTokens("quais as categorias de quartos do hotel brooklin?");
  assert.ok(tokens.includes("brooklin"));
});

test("applyQueryEntityRankingBoost prefers matching product segment", () => {
  const rows = [
    { score: 0.9, title: "Plano Basic — FAQ", text: "Recursos básicos" },
    { score: 0.85, title: "Plano Enterprise — FAQ", text: "Recursos avançados e SLA" },
  ];
  const boosted = applyQueryEntityRankingBoost(rows, "preço plano enterprise", (r) => `${r.title} ${r.text}`);
  assert.equal(boosted[0]?.title, "Plano Enterprise — FAQ");
});

test("applyQueryEntityRankingBoost prefers matching establishment", () => {
  const rows = [
    { score: 0.9, title: "Rock Blue Ocean Suites", text: "Suites premium na praia" },
    { score: 0.85, title: "Hotel Brooklin", text: "Quartos standard, deluxe e suite" },
  ];
  const boosted = applyQueryEntityRankingBoost(
    rows,
    "quais categorias de quartos do hotel brooklin",
    (r) => `${r.title} ${r.text}`,
  );
  assert.equal(boosted[0]?.title, "Hotel Brooklin");
});
