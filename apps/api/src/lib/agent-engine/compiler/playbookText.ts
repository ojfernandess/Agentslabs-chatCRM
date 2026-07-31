import { createHash } from "node:crypto";
import { parsePromptBlocks } from "../../agentPlaybook.js";

/** Extrai texto do playbook a partir de behaviorConfig.promptBuilder. */
export function playbookTextFromBehavior(
  behaviorConfig: Record<string, unknown> | null | undefined,
): string {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return "";
  const pb = behaviorConfig.promptBuilder;
  if (pb && typeof pb === "object") {
    const o = pb as Record<string, unknown>;
    if (typeof o.userCore === "string" && o.userCore.trim()) return o.userCore;
    if (o.blocks && typeof o.blocks === "object") {
      const parsed = parsePromptBlocks(o.blocks as Parameters<typeof parsePromptBlocks>[0]);
      const parts = [
        parsed.objective,
        parsed.restrictions,
        parsed.flows,
        parsed.tools,
        parsed.fallback,
      ].filter((x) => x?.trim());
      if (parts.length) return parts.join("\n\n");
    }
  }
  return "";
}

export function extractObjectiveFromPlaybook(playbook: string): string {
  const m = playbook.match(
    /(?:^|\n)#{1,3}\s*(?:Objetivo|Objective|Goal)\s*\n+([\s\S]*?)(?=\n#{1,3}\s|\n\*\*|$)/i,
  );
  if (m?.[1]?.trim()) return m[1].trim().slice(0, 500);
  const first = playbook.split(/\n\n+/).find((p) => p.trim().length > 20);
  return (first ?? "").trim().slice(0, 300);
}

export function extractLinesMatching(playbook: string, re: RegExp): string[] {
  return playbook
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => re.test(l))
    .slice(0, 12);
}

export function playbookHash(playbook: string): string {
  return createHash("sha256").update(playbook).digest("hex").slice(0, 16);
}
