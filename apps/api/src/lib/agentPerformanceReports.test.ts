import { describe, expect, it } from "vitest";
import { mergePresenceIntervals } from "./agentPerformanceReports.js";

describe("mergePresenceIntervals", () => {
  it("fundes intervalos sobrepostos (multi-abas)", () => {
    const base = new Date("2026-01-01T10:00:00Z");
    const merged = mergePresenceIntervals([
      { start: base, end: new Date("2026-01-01T10:30:00Z") },
      { start: new Date("2026-01-01T10:15:00Z"), end: new Date("2026-01-01T11:00:00Z") },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.start).toEqual(base);
    expect(merged[0]!.end).toEqual(new Date("2026-01-01T11:00:00Z"));
  });

  it("mantém intervalos separados", () => {
    const merged = mergePresenceIntervals([
      { start: new Date("2026-01-01T08:00:00Z"), end: new Date("2026-01-01T09:00:00Z") },
      { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T11:00:00Z") },
    ]);
    expect(merged).toHaveLength(2);
  });
});
