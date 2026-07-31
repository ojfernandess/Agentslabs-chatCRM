/**
 * Extracção estática do playbook → estruturas IR (cacheable por playbookHash).
 * Genérico: usa parsers existentes; não adiciona regras de segmento.
 */
import type { CompletionCriterion, ReplyTemplateSpec, ToolSpec, TurnPatternSpec } from "../contract/CompletionTypes.js";
import type { FlowDefinition, FlowStep } from "../contract/FlowDefinition.js";
import type { ConstraintRule, PolicyRule } from "../contract/PolicyTypes.js";
import {
  extractToolNamesFromText,
  GENERIC_TURN_PATTERNS,
  parseCategoryToolMapFromPlaybook,
  parseRequiredToolNamesFromText,
} from "../validators/requiredToolNamesParser.js";
import {
  parseCompletionToolHintsFromPlaybook,
  parseExclusiveToolsForConfirmationTurn,
  parseForbiddenSameTurnPairsFromPlaybook,
  parseOmitToolsWhenSlotsPresentFromPlaybook,
} from "../validators/turnPolicyParser.js";
import { COMPLETION_LINE_RE } from "../validators/playbookRuntimePolicy.js";
import {
  extractLinesMatching,
  extractObjectiveFromPlaybook,
} from "./playbookText.js";

export type StaticPromptIRExtract = {
  objective: string;
  flows: FlowDefinition[];
  toolsCatalog: ToolSpec[];
  policies: PolicyRule[];
  constraints: ConstraintRule[];
  completionCriteria: CompletionCriterion[];
  turnPatterns: TurnPatternSpec[];
  replyTemplates: ReplyTemplateSpec[];
  restrictions: string[];
  preconditions: string[];
  postconditions: string[];
  forbiddenSameTurnPairs: Array<{ a: string; b: string }>;
};

function extractFlowsFromPlaybook(playbook: string): FlowDefinition[] {
  const steps: FlowStep[] = [];
  const lines = playbook.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!/\|/.test(line)) continue;
    const categoryMatch = line.match(/\|\s*\*{0,2}(C\d+|S\d+|Passo\s*\d+|N=\d+[^|]*)\*{0,2}\s*\|/i);
    if (!categoryMatch) continue;
    const category = categoryMatch[1]!.trim();
    const tools = extractToolNamesFromText(line);
    if (tools.length === 0 && !/\b(check|consult|upload|reference|conclus)/i.test(line)) continue;
    steps.push({
      id: `step_${category.replace(/\s+/g, "_").toLowerCase()}_${i}`,
      label: category,
      category,
      toolNames: tools,
      preconditions: [],
      postconditions: [],
      sourceLine: line.slice(0, 200),
    });
  }
  if (steps.length === 0) return [];
  return [{ id: "primary_flow", label: "Playbook flow", steps }];
}

function extractPoliciesFromPlaybook(playbook: string): PolicyRule[] {
  const policies: PolicyRule[] = [];
  let idx = 0;

  for (const pair of parseForbiddenSameTurnPairsFromPlaybook(playbook)) {
    policies.push({
      id: `policy_pair_${idx++}`,
      kind: "forbidden_same_turn_pair",
      pair: { a: pair.a, b: pair.b },
      description: `Forbidden same turn: ${pair.a} + ${pair.b}`,
    });
  }

  const exclusive = parseExclusiveToolsForConfirmationTurn(playbook);
  if (exclusive.length > 0) {
    policies.push({
      id: `policy_exclusive_${idx++}`,
      kind: "exclusive_on_confirmation",
      tools: exclusive,
      description: "Exclusive tools on confirmation turn",
    });
  }

  for (const omit of parseOmitToolsWhenSlotsPresentFromPlaybook(playbook)) {
    policies.push({
      id: `policy_omit_${idx++}`,
      kind: "omit_tool_when_slots_present",
      tools: omit.tools,
      slotKeys: omit.slotKeys,
      description: `Omit tools when slots filled: ${omit.slotKeys.join(", ")}`,
    });
  }

  const prereqLines = extractLinesMatching(
    playbook,
    /confirma[cç][aã]o|pr[eé]-requisito|antes de.*check|reference.*before/i,
  );
  if (prereqLines.length > 0) {
    const tools = extractToolNamesFromText(prereqLines.join("\n"));
    if (tools.length > 0) {
      policies.push({
        id: `policy_prereq_${idx++}`,
        kind: "confirmation_prerequisite",
        tools,
        description: "Confirmation prerequisite tools from playbook",
      });
    }
  }

  return policies;
}

function extractCompletionCriteria(playbook: string): CompletionCriterion[] {
  const hints = parseCompletionToolHintsFromPlaybook(playbook);
  const criteria: CompletionCriterion[] = [];
  hints.forEach((tool, i) => {
    criteria.push({
      id: `completion_${i}`,
      description: `Completion tool: ${tool}`,
      toolNames: [tool],
    });
  });
  const completionLines = playbook
    .split(/\n/)
    .filter((l) => COMPLETION_LINE_RE.test(l))
    .slice(0, 5);
  completionLines.forEach((line, i) => {
    if (criteria.some((c) => c.description.includes(line.slice(0, 40)))) return;
    criteria.push({
      id: `completion_line_${i}`,
      description: line.trim().slice(0, 120),
      toolNames: extractToolNamesFromText(line),
    });
  });
  return criteria;
}

function extractReplyTemplates(playbook: string): ReplyTemplateSpec[] {
  const templates: ReplyTemplateSpec[] = [];
  let idx = 0;
  for (const line of playbook.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const modelo = trimmed.match(/Modelo\s+(S\d+[a-z]?|Verificar)/i);
    if (modelo) {
      templates.push({
        id: `reply_${modelo[1]!.toLowerCase()}`,
        trigger: "step_reply",
        label: modelo[1]!,
        playbookExcerpt: trimmed.slice(0, 160),
      });
      continue;
    }
    if (/script\s+fixo|template\s+fixo|ack\s+curto/i.test(trimmed)) {
      templates.push({
        id: `reply_script_${idx++}`,
        trigger: "on_stall",
        label: "fixed_script",
        playbookExcerpt: trimmed.slice(0, 160),
      });
    }
    if (/consultar_reserva|consultar reserva/i.test(trimmed) && /modelo|script|template/i.test(trimmed)) {
      templates.push({
        id: `reply_after_reservation_${idx++}`,
        trigger: "after_tool_success",
        bindToolPattern: "consultar_reserva",
        label: "reservation_lookup_reply",
        playbookExcerpt: trimmed.slice(0, 160),
      });
    }
  }
  return templates;
}

function buildToolsCatalog(playbook: string): ToolSpec[] {
  const categoryMap = parseCategoryToolMapFromPlaybook(playbook);
  const requiredGlobal = parseRequiredToolNamesFromText(playbook);
  const catalog = new Map<string, ToolSpec>();

  for (const [category, tools] of categoryMap) {
    for (const name of tools) {
      catalog.set(name.toLowerCase(), {
        name,
        role: requiredGlobal.some((r) => r.toLowerCase() === name.toLowerCase())
          ? "required"
          : "catalog",
        category,
      });
    }
  }
  for (const name of requiredGlobal) {
    if (!catalog.has(name.toLowerCase())) {
      catalog.set(name.toLowerCase(), { name, role: "required" });
    }
  }
  return [...catalog.values()];
}

/** Extracção estática — independente de userMessage / turn state. */
export function extractStaticPromptIR(playbook: string): StaticPromptIRExtract {
  const forbiddenSameTurnPairs = parseForbiddenSameTurnPairsFromPlaybook(playbook).map((p) => ({
    a: p.a,
    b: p.b,
  }));

  const restrictions = extractLinesMatching(playbook, /proibid|obrigat|never|must not|bloquead/i);
  const preconditions = extractLinesMatching(playbook, /pr[eé]-condi|before|antes de|requer/i);
  const postconditions = extractLinesMatching(playbook, /p[oó]s-condi|after|depois de|conclus/i);

  const constraints: ConstraintRule[] = restrictions.map((text, i) => ({
    id: `constraint_${i}`,
    text,
  }));

  const turnPatterns: TurnPatternSpec[] = GENERIC_TURN_PATTERNS.map((p) => ({
    id: p.id,
    registryId: p.id,
  }));

  return {
    objective: extractObjectiveFromPlaybook(playbook) || "Assist user per agent playbook",
    flows: extractFlowsFromPlaybook(playbook),
    toolsCatalog: buildToolsCatalog(playbook),
    policies: extractPoliciesFromPlaybook(playbook),
    constraints,
    completionCriteria: extractCompletionCriteria(playbook),
    turnPatterns,
    replyTemplates: extractReplyTemplates(playbook),
    restrictions,
    preconditions,
    postconditions,
    forbiddenSameTurnPairs,
  };
}
