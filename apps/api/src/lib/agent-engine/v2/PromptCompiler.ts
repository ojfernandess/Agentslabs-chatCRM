/**
 * Prompt Compiler — extrai Prompt Contract estruturado do behaviorConfig.
 * Supervisor e Workflow Validator consomem contratos, não texto livre.
 */

import { createHash } from "node:crypto";
import { parsePromptBlocks, type PromptBlocks } from "../../agentPlaybook.js";
import { auditPromptAssembly } from "../audit/promptAssemblyAudit.js";
import {
  parseCategoryToolMapFromPlaybook,
  parseRequiredToolNamesFromText,
  playbookTextFromBehavior,
  resolveRequiredToolNamesFromBehavior,
} from "../validators/requiredToolNamesParser.js";
import {
  parseCompletionToolHintsFromPlaybook,
  parseForbiddenSameTurnPairsFromPlaybook,
  parseExclusiveToolsForConfirmationTurn,
  resolveTurnPolicy,
} from "../validators/turnPolicyParser.js";
import type { PromptContract, PromptContractStep } from "./types.js";

function hashPlaybook(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Extrai steps de fluxo a partir dos blocos do playbook. */
function compileStepsFromBlocks(blocks: PromptBlocks, playbook: string): PromptContractStep[] {
  const steps: PromptContractStep[] = [];
  const categoryMap = parseCategoryToolMapFromPlaybook(playbook);

  // Categorias C1..Cn da tabela do playbook
  const categoryRe = /\|\s*(C\d+)\s*\|\s*\*\*([^|*]+)\*\*\s*\|\s*([^|]+)\|\s*([^|]+)\|/gi;
  let m: RegExpExecArray | null;
  while ((m = categoryRe.exec(playbook)) !== null) {
    const id = m[1]!.trim();
    const label = m[2]!.trim();
    const detectCol = m[3]!.trim();
    const toolsCol = m[4]!.trim();
    const toolsFromCol = parseRequiredToolNamesFromText(toolsCol);
    const toolsFromMap = categoryMap.get(id) ?? [];
    const tools = [...new Set([...toolsFromCol, ...toolsFromMap])];
    const constraints: string[] = [];
    if (/PROIBIDO|proibid|never|nunca/i.test(detectCol)) {
      constraints.push(detectCol.slice(0, 200));
    }
    steps.push({ id, label, tools, constraints, dependsOn: [] });
  }

  // Fallback: bloco flows como step único
  if (steps.length === 0 && blocks.flows?.trim()) {
    const flowTools = parseRequiredToolNamesFromText(blocks.flows);
    steps.push({
      id: "flows",
      label: "Fluxos",
      tools: flowTools,
      constraints: parseRequiredToolNamesFromText(blocks.restrictions ?? "").map(() => ""),
      dependsOn: [],
    });
  }

  return steps;
}

export type CompilePromptContractOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  systemPrompt?: string;
};

/**
 * Compila Prompt Contract a partir do behaviorConfig.
 * Genérico — qualquer agente, segmento ou workflow.
 */
export function compilePromptContract(opts: CompilePromptContractOpts): PromptContract {
  const behaviorConfig = opts.behaviorConfig ?? {};
  const playbook = playbookTextFromBehavior(behaviorConfig);
  const pb = behaviorConfig.promptBuilder;
  const blocksRaw =
    pb && typeof pb === "object"
      ? ((pb as Record<string, unknown>).blocks as unknown)
      : null;
  const blocks = parsePromptBlocks(blocksRaw);

  const steps = compileStepsFromBlocks(blocks, playbook);
  const globalRequiredTools = resolveRequiredToolNamesFromBehavior(behaviorConfig);
  const globalForbiddenPairs = parseForbiddenSameTurnPairsFromPlaybook(playbook);
  const completionCriteria = parseCompletionToolHintsFromPlaybook(playbook);
  const turnPolicyTemplate = resolveTurnPolicy(behaviorConfig, {});

  const optionalFromTools = parseRequiredToolNamesFromText(blocks.tools ?? "");
  const globalOptionalTools = optionalFromTools.filter(
    (t) => !globalRequiredTools.includes(t),
  );

  const restrictions: string[] = [];
  if (blocks.restrictions?.trim()) {
    restrictions.push(...blocks.restrictions.split(/\n+/).filter((l) => l.trim().length > 8).slice(0, 20));
  }

  const auditResult = auditPromptAssembly({
    systemPrompt: opts.systemPrompt,
    promptValidation: { blocks },
  });

  // Confirmação: tools exclusivas do portão
  const confirmationExclusive = parseExclusiveToolsForConfirmationTurn(playbook);
  if (confirmationExclusive.length > 0) {
    steps.push({
      id: "confirmation_gate",
      label: "Portão de confirmação",
      tools: confirmationExclusive,
      constraints: ["exclusive_turn_tools"],
      dependsOn: [],
    });
  }

  return {
    version: 2,
    compiledAt: new Date().toISOString(),
    sourceHash: hashPlaybook(playbook),
    steps,
    globalRequiredTools,
    globalOptionalTools,
    globalForbiddenPairs,
    restrictions,
    completionCriteria,
    turnPolicyTemplate,
    audit: {
      loadedCompletely: auditResult.loadedCompletely,
      restrictionsPresent: auditResult.restrictionsPresent,
      issues: auditResult.issues,
    },
  };
}
