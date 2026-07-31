import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enrichPromptIr,
  parsePlaybookEnrichment,
  templateFactsFromEnrichedIr,
} from "./playbookEnrichment.js";
import { compileStaticPromptIR } from "./compilePromptToIR.js";
import { PROMPT_IR_VERSION } from "../contract/PromptIR.js";

test("parsePlaybookEnrichment reads structured metadata", () => {
  const e = parsePlaybookEnrichment({
    playbookEnrichment: {
      checkinLink: "https://vet.example/checkin",
      defaultTemplateFacts: { brand: "VetClinic" },
    },
  });
  assert.equal(e.checkinLink, "https://vet.example/checkin");
  assert.equal(e.defaultTemplateFacts?.brand, "VetClinic");
});

test("enrichPromptIr injects checkinLink template facts", () => {
  const staticIr = compileStaticPromptIR({
    promptBuilder: { userCore: "## Objetivo\nCheck-in hotel.\n" },
  });
  const base = {
    promptIrVersion: PROMPT_IR_VERSION,
    ...staticIr,
    tools: { catalog: [], required: [], optional: [], forbidden: [] },
    turnPolicy: {},
    metadata: { hash: "abc", playbookHash: "pb", compiledAt: "", playbookCharCount: 10 },
  };
  const enriched = enrichPromptIr(base, {
    playbookEnrichment: { checkinLink: "https://custom.example/in" },
  });
  const facts = templateFactsFromEnrichedIr(enriched);
  assert.equal(facts.checkinLink, "https://custom.example/in");
});
