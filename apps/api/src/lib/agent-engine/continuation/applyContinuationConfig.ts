import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db.js";
import { parseAgentContinuationConfig } from "./parseContinuationConfig.js";
import {
  DEFAULT_AGENT_CONTINUATION_TEMPLATES,
  type AgentContinuationTemplateId,
} from "./templates.js";

export async function applyAgentContinuationTemplateToAgent(input: {
  organizationId: string;
  botId: string;
  templateId?: AgentContinuationTemplateId;
  merge?: boolean;
}): Promise<{
  profileId: string;
  continuationEnabled: boolean;
  ruleIds: string[];
  templateId: string;
}> {
  const templateId = input.templateId ?? "auda_post_checkin_passo8";
  const template = DEFAULT_AGENT_CONTINUATION_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`unknown_continuation_template:${templateId}`);
  }

  const profile = await prisma.automationAgentProfile.findFirst({
    where: { organizationId: input.organizationId, botId: input.botId },
    select: { id: true, behaviorConfig: true },
  });
  if (!profile) {
    throw new Error("automation_agent_profile_not_found");
  }

  const beh =
    profile.behaviorConfig && typeof profile.behaviorConfig === "object"
      ? ({ ...(profile.behaviorConfig as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const existing = parseAgentContinuationConfig(beh.agentContinuation);
  const mergedRules = input.merge && existing?.rules?.length
    ? [
        ...existing.rules.filter((r) => !template.rules.some((t) => t.id === r.id)),
        ...template.rules,
      ]
    : [...template.rules];

  beh.agentContinuation = {
    enabled: template.enabled,
    rules: mergedRules,
  };

  await prisma.automationAgentProfile.update({
    where: { id: profile.id },
    data: { behaviorConfig: beh as Prisma.InputJsonValue },
  });

  return {
    profileId: profile.id,
    continuationEnabled: true,
    ruleIds: mergedRules.map((r) => r.id),
    templateId,
  };
}
