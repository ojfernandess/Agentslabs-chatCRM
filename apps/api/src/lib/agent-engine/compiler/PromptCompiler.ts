import { createHash } from "node:crypto";
import { parsePromptBlocks } from "../../agentPlaybook.js";
import {
  parseCategoryToolMapFromPlaybook,
  resolveRequiredToolNamesForTurn,
} from "../validators/requiredToolNamesParser.js";
import {
  parseForbiddenSameTurnPairsFromPlaybook,
  resolveTurnPolicy,
  type TurnPolicy,
} from "../validators/turnPolicyParser.js";
import type { PromptContract } from "../core/types.js";

function playbookTextFromBehavior(behaviorConfig: Record<string, unknown> | null | undefined): string {
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

function extractObjective(playbook: string): string {
  const m = playbook.match(/(?:^|\n)#{1,3}\s*(?:Objetivo|Objective|Goal)\s*\n+([\s\S]*?)(?=\n#{1,3}\s|\n\*\*|$)/i);
  if (m?.[1]?.trim()) return m[1].trim().slice(0, 500);
  const first = playbook.split(/\n\n+/).find((p) => p.trim().length > 20);
  return (first ?? "").trim().slice(0, 300);
}

function extractLinesMatching(playbook: string, re: RegExp): string[] {
  return playbook
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => re.test(l))
    .slice(0, 12);
}

export type CompilePromptContractOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames?: string[];
};

/**
 * Compila playbook → PromptContract estruturado (1x por turno).
 * Genérico: usa parsers existentes, sem regras de segmento no compiler.
 */
export function compilePromptContract(opts: CompilePromptContractOpts): PromptContract {
  const playbook = playbookTextFromBehavior(opts.behaviorConfig);
  const userMessage = (opts.userMessage ?? "").trim();
  const turnPolicy: TurnPolicy = resolveTurnPolicy(opts.behaviorConfig, { userMessage });
  const requiredToolNames = resolveRequiredToolNamesForTurn(opts.behaviorConfig, {
    userMessage,
    availableToolNames: opts.availableToolNames,
  });
  const forbiddenSameTurnPairs = parseForbiddenSameTurnPairsFromPlaybook(playbook);
  const categoryMap = parseCategoryToolMapFromPlaybook(playbook);

  const optionalToolNames: string[] = [];
  for (const tools of categoryMap.values()) {
    for (const t of tools) {
      if (!requiredToolNames.some((r) => r.toLowerCase() === t.toLowerCase())) {
        optionalToolNames.push(t);
      }
    }
  }

  const forbiddenToolNames = turnPolicy.blockEscalation
    ? ["transfer_to_team", "call_human", "set_conversation_status"]
    : [];

  const restrictions = extractLinesMatching(playbook, /proibid|obrigat|never|must not|bloquead/i);
  const preconditions = extractLinesMatching(playbook, /pr[eé]-condi|before|antes de|requer/i);
  const postconditions = extractLinesMatching(playbook, /p[oó]s-condi|after|depois de|conclus/i);

  const payload = {
    userMessage,
    requiredToolNames,
    turnPolicy,
    forbiddenSameTurnPairs: forbiddenSameTurnPairs.map((p) => ({ a: p.a, b: p.b })),
  };
  const promptHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);

  return {
    version: 1,
    compiledAt: new Date().toISOString(),
    promptHash,
    objective: extractObjective(playbook) || "Assist user per agent playbook",
    requiredToolNames,
    optionalToolNames: [...new Set(optionalToolNames)].slice(0, 20),
    forbiddenToolNames,
    forbiddenSameTurnPairs: forbiddenSameTurnPairs.map((p) => ({ a: p.a, b: p.b })),
    preconditions,
    postconditions,
    restrictions,
    turnPolicy,
  };
}
