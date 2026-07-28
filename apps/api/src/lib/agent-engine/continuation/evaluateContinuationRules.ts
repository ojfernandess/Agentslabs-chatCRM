import type { AgentContinuationRule, AgentContinuationTrigger, ContinuationTurnContext } from "./types.js";

function toolMatches(name: string, pattern: string): boolean {
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  return n === p || n.includes(p);
}

function whenMatches(when: AgentContinuationRule["when"], ctx: ContinuationTurnContext): boolean {
  if (!when) return true;

  if (when.toolCalled) {
    const tools = ctx.toolRound?.tools ?? [];
    const matched = tools.filter((t) => toolMatches(t.name, when.toolCalled!));
    if (matched.length === 0) return false;
    if (when.toolOk === true && !matched.some((t) => t.ok)) return false;
    if (when.toolOk === false && matched.some((t) => t.ok)) return false;
  }

  if (when.flowStep !== undefined && ctx.flowStep !== when.flowStep) return false;

  if (when.resultDelivered === true && !ctx.toolRound?.resultDeliveredToCustomer) return false;
  if (when.resultDelivered === false && ctx.toolRound?.resultDeliveredToCustomer) return false;

  if (when.replyMinChars != null && ctx.replyText.trim().length < when.replyMinChars) return false;

  if (when.replyContains) {
    if (!ctx.replyText.toLowerCase().includes(when.replyContains.toLowerCase())) return false;
  }

  return true;
}

/** Regras que correspondem ao contexto do turno concluído. */
export function matchAgentContinuationRules(input: {
  rules: AgentContinuationRule[];
  trigger: AgentContinuationTrigger;
  ctx: ContinuationTurnContext;
  continuationCounts: Record<string, number>;
  pendingRuleId?: string | null;
}): AgentContinuationRule[] {
  const { rules, trigger, ctx, continuationCounts, pendingRuleId } = input;
  if (pendingRuleId) return [];

  const matched: AgentContinuationRule[] = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.trigger !== trigger) continue;
    const max = rule.maxPerConversation ?? 1;
    const count = continuationCounts[rule.id] ?? 0;
    if (count >= max) continue;
    if (!whenMatches(rule.when, ctx)) continue;
    matched.push(rule);
  }
  return matched;
}
