import type {
  AgentContinuationConfig,
  AgentContinuationRule,
  AgentContinuationTrigger,
  AgentContinuationWhen,
} from "./types.js";

function parseWhen(raw: unknown): AgentContinuationWhen | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const when: AgentContinuationWhen = {};
  if (typeof o.toolCalled === "string" && o.toolCalled.trim()) {
    when.toolCalled = o.toolCalled.trim().slice(0, 120);
  }
  if (typeof o.toolOk === "boolean") when.toolOk = o.toolOk;
  if (typeof o.flowStep === "string" && o.flowStep.trim()) {
    when.flowStep = o.flowStep.trim().slice(0, 120);
  }
  if (typeof o.resultDelivered === "boolean") when.resultDelivered = o.resultDelivered;
  if (typeof o.replyContains === "string" && o.replyContains.trim()) {
    when.replyContains = o.replyContains.trim().slice(0, 500);
  }
  if (typeof o.replyMinChars === "number" && Number.isFinite(o.replyMinChars) && o.replyMinChars >= 0) {
    when.replyMinChars = Math.floor(o.replyMinChars);
  }
  return Object.keys(when).length > 0 ? when : undefined;
}

function parseTrigger(raw: unknown): AgentContinuationTrigger | null {
  if (raw === "after_reply" || raw === "after_tool_round") return raw;
  return null;
}

function parseRule(raw: unknown): AgentContinuationRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id || id.length > 120) return null;
  const trigger = parseTrigger(o.trigger);
  if (!trigger) return null;
  const turnHint = typeof o.turnHint === "string" ? o.turnHint.trim() : "";
  if (!turnHint || turnHint.length < 8) return null;
  const rule: AgentContinuationRule = {
    id,
    trigger,
    turnHint: turnHint.slice(0, 4000),
  };
  if (typeof o.name === "string" && o.name.trim()) rule.name = o.name.trim().slice(0, 200);
  if (o.enabled === false) rule.enabled = false;
  if (typeof o.delaySeconds === "number" && Number.isFinite(o.delaySeconds)) {
    rule.delaySeconds = Math.max(0, Math.min(3600, Math.floor(o.delaySeconds)));
  }
  if (typeof o.maxPerConversation === "number" && Number.isFinite(o.maxPerConversation)) {
    rule.maxPerConversation = Math.max(1, Math.min(20, Math.floor(o.maxPerConversation)));
  }
  const when = parseWhen(o.when);
  if (when) rule.when = when;
  return rule;
}

export function parseAgentContinuationConfig(raw: unknown): AgentContinuationConfig | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: AgentContinuationConfig = {};
  if (o.enabled === false) out.enabled = false;
  else if (o.enabled === true) out.enabled = true;
  if (o.rules === undefined) {
    out.rules = [];
  } else if (!Array.isArray(o.rules)) {
    return null;
  } else {
    const rules: AgentContinuationRule[] = [];
    for (const item of o.rules) {
      const rule = parseRule(item);
      if (!rule) return null;
      rules.push(rule);
    }
    out.rules = rules;
  }
  return out;
}

export function isAgentContinuationEnabled(config: AgentContinuationConfig | null | undefined): boolean {
  if (!config) return false;
  if (config.enabled === false) return false;
  return (config.rules ?? []).some((r) => r.enabled !== false);
}

export function activeAgentContinuationRules(
  config: AgentContinuationConfig | null | undefined,
): AgentContinuationRule[] {
  if (!isAgentContinuationEnabled(config)) return [];
  return (config?.rules ?? []).filter((r) => r.enabled !== false);
}
