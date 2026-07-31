import { createHash } from "node:crypto";
import type { PromptIR } from "../contract/PromptIR.js";
import { PROMPT_IR_VERSION } from "../contract/PromptIR.js";
import {
  dedupeRequiredToolAliases,
  parseCategoryToolMapFromPlaybook,
  resolveRequiredToolNamesForTurn,
  toolOutcomeSatisfiesRequired,
} from "../validators/requiredToolNamesParser.js";
import {
  resolveTurnPolicy,
  resolveCompletionRequiredToolsForConfirmation,
  type TurnPolicy,
} from "../validators/turnPolicyParser.js";
import { getCachedStaticPromptIR } from "./PromptIRCache.js";
import { enrichPromptIr } from "./playbookEnrichment.js";
import { playbookHash, playbookTextFromBehavior } from "./playbookText.js";

export type CompilePromptToIROpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames?: string[];
  priorToolOutcomes?: Array<{ name: string; ok?: boolean }>;
  sessionPriorOutcomes?: Array<{ name: string; ok?: boolean }>;
  flowSlots?: Record<string, string | number | boolean> | null;
  freezeCompletionPromotion?: boolean;
  lastAssistantMessage?: string | null;
  memory?: Record<string, unknown> | null;
  postCompletionFollowUp?: boolean;
  workflowPlannedToolNames?: string[];
};

function resolveTurnTools(opts: CompilePromptToIROpts, turnPolicy: TurnPolicy): {
  required: string[];
  optional: string[];
  forbidden: string[];
} {
  const playbook = playbookTextFromBehavior(opts.behaviorConfig);
  const userMessage = (opts.userMessage ?? "").trim();
  const priorToolOutcomes = (opts.priorToolOutcomes ?? []).filter((t) => t.ok !== false);
  const sessionPriorOutcomes = (opts.sessionPriorOutcomes ?? priorToolOutcomes).filter(
    (t) => t.ok !== false,
  );
  const availableSet = new Set(
    (opts.availableToolNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
  );

  const baseRequired = resolveRequiredToolNamesForTurn(opts.behaviorConfig, {
    userMessage,
    availableToolNames: opts.availableToolNames,
  });
  const exclusiveRequired = (turnPolicy.exclusiveAllowedTools ?? []).filter((tool) => {
    if (availableSet.size > 0 && !availableSet.has(tool.trim().toLowerCase())) return false;
    if (turnPolicy.forceExclusiveExecution) return true;
    return !toolOutcomeSatisfiesRequired(tool, priorToolOutcomes);
  });
  const completionRequired = resolveCompletionRequiredToolsForConfirmation(
    turnPolicy,
    priorToolOutcomes,
    {
      sessionPriorOutcomes,
      flowSlots: opts.flowSlots,
      freezeCompletionPromotion: opts.freezeCompletionPromotion,
      lastAssistantMessage: opts.lastAssistantMessage,
    },
  );
  const workflowPlanned = (opts.workflowPlannedToolNames ?? [])
    .map((n) => n.trim())
    .filter(Boolean)
    .filter((tool) => availableSet.size === 0 || availableSet.has(tool.toLowerCase()));

  const required = dedupeRequiredToolAliases([
    ...baseRequired,
    ...exclusiveRequired,
    ...completionRequired,
    ...workflowPlanned,
  ]);

  const categoryMap = parseCategoryToolMapFromPlaybook(playbook);
  const optional: string[] = [];
  for (const tools of categoryMap.values()) {
    for (const t of tools) {
      if (!required.some((r) => r.toLowerCase() === t.toLowerCase())) {
        optional.push(t);
      }
    }
  }

  const forbidden = turnPolicy.blockEscalation
    ? ["transfer_to_team", "call_human", "set_conversation_status"]
    : [];

  return {
    required,
    optional: [...new Set(optional)].slice(0, 20),
    forbidden,
  };
}

/**
 * Compila playbook → Prompt IR (1× por turno).
 * Extracção estática cacheada; resolução de turno sempre fresh.
 */
export function compilePromptToIR(opts: CompilePromptToIROpts): PromptIR {
  const playbook = playbookTextFromBehavior(opts.behaviorConfig);
  const pbHash = playbookHash(playbook);
  const staticIr = getCachedStaticPromptIR(playbook, pbHash);

  const userMessage = (opts.userMessage ?? "").trim();
  const priorToolOutcomes = (opts.priorToolOutcomes ?? []).filter((t) => t.ok !== false);

  const turnPolicy = resolveTurnPolicy(opts.behaviorConfig, {
    userMessage,
    priorToolOutcomes,
    availableToolNames: opts.availableToolNames,
    flowSlots: opts.flowSlots,
    lastAssistantMessage: opts.lastAssistantMessage,
    memory: opts.memory,
    postCompletionFollowUp: opts.postCompletionFollowUp,
  });

  const tools = resolveTurnTools(opts, turnPolicy);

  const catalog = staticIr.toolsCatalog.map((t) => {
    let role = t.role;
    if (tools.required.some((r) => r.toLowerCase() === t.name.toLowerCase())) {
      role = "required";
    } else if (tools.forbidden.some((f) => t.name.toLowerCase().includes(f.toLowerCase()))) {
      role = "forbidden";
    } else if (tools.optional.some((o) => o.toLowerCase() === t.name.toLowerCase())) {
      role = "optional";
    }
    return { ...t, role };
  });

  const turnPayload = {
    userMessage,
    required: tools.required,
    turnPolicy,
    forbiddenSameTurnPairs: staticIr.forbiddenSameTurnPairs,
  };
  const hash = createHash("sha256").update(JSON.stringify(turnPayload)).digest("hex").slice(0, 16);

  return enrichPromptIr(
    {
      promptIrVersion: PROMPT_IR_VERSION,
      objective: staticIr.objective,
      flows: staticIr.flows,
      tools: {
        catalog,
        required: tools.required,
        optional: tools.optional,
        forbidden: tools.forbidden,
      },
      policies: staticIr.policies,
      constraints: staticIr.constraints,
      completionCriteria: staticIr.completionCriteria,
      turnPatterns: staticIr.turnPatterns,
      replyTemplates: staticIr.replyTemplates,
      restrictions: staticIr.restrictions,
      preconditions: staticIr.preconditions,
      postconditions: staticIr.postconditions,
      forbiddenSameTurnPairs: staticIr.forbiddenSameTurnPairs,
      turnPolicy,
      metadata: {
        hash,
        playbookHash: pbHash,
        compiledAt: new Date().toISOString(),
        playbookCharCount: playbook.length,
      },
    },
    opts.behaviorConfig,
  );
}

/** Extracção estática only — para cache warm / audit sem turn context. */
export function compileStaticPromptIR(
  behaviorConfig: Record<string, unknown> | null | undefined,
): ReturnType<typeof getCachedStaticPromptIR> {
  const playbook = playbookTextFromBehavior(behaviorConfig);
  return getCachedStaticPromptIR(playbook, playbookHash(playbook));
}
