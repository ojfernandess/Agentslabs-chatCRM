import assert from "node:assert/strict";
import test from "node:test";
import { mergeKbPrefetchAppendix, type KbPrefetchResult } from "./parallelKbPrefetch.js";

test("mergeKbPrefetchAppendix dedupes articles and formats appendix", () => {
  const article = {
    id: "a1",
    title: "Hotel",
    content: "WiFi free",
    category: null,
    tags: [],
    isActive: true,
    syncToAi: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    organizationId: "org",
  };
  const results: KbPrefetchResult[] = [
    {
      articleId: "a1",
      title: "Hotel",
      ranked: [{ article, score: 2, excerpt: "Suite deluxe" }],
    },
    {
      articleId: "a1",
      title: "Hotel",
      ranked: [{ article, score: 5, excerpt: "WiFi password 123" }],
    },
  ];
  const appendix = mergeKbPrefetchAppendix(results);
  assert.match(appendix, /WiFi password 123/);
  assert.match(appendix, /Hotel/);
});
