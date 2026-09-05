import { describe, expect, it } from "vitest";
import { parseIntelligentTaggingTrigger } from "./types.js";

describe("parseIntelligentTaggingTrigger", () => {
  it("maps known triggers", () => {
    expect(parseIntelligentTaggingTrigger("manual")).toBe("manual");
    expect(parseIntelligentTaggingTrigger("on_resolve")).toBe("on_resolve");
    expect(parseIntelligentTaggingTrigger("during_conversation")).toBe("during_conversation");
  });

  it("defaults unknown values to manual", () => {
    expect(parseIntelligentTaggingTrigger(null)).toBe("manual");
    expect(parseIntelligentTaggingTrigger(undefined)).toBe("manual");
    expect(parseIntelligentTaggingTrigger("invalid")).toBe("manual");
  });
});
