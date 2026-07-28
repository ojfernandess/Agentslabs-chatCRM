import type { Bot, Conversation, Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { TurnContext } from "../core/types.js";
import {
  planScheduledToolInvocations,
  type ScheduledToolInvocation,
} from "./TurnToolScheduler.js";

export type ScheduledToolOutcome = {
  name: string;
  ok: boolean;
  preview: string;
  structuredPayload?: unknown;
  scheduled: true;
};

export type InvokeScheduledToolsInput = {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  message: Message;
  log: FastifyBaseLogger;
  behaviorConfig: Record<string, unknown>;
  turnContext: TurnContext;
  existingOutcomes?: Array<{ name: string; ok?: boolean; preview?: string }>;
  userMessage: string;
  kbPrefetchAppendix?: string;
};

export type InvokeScheduledToolsResult = {
  invocations: ScheduledToolInvocation[];
  outcomes: ScheduledToolOutcome[];
};

/** Invoca tools planeadas pelo scheduler (HTTP + nativas via bridge do agentNativeLlm). */
export async function invokeScheduledTools(
  input: InvokeScheduledToolsInput,
): Promise<InvokeScheduledToolsResult> {
  const invocations = planScheduledToolInvocations(
    input.turnContext,
    input.existingOutcomes ?? [],
  );
  if (invocations.length === 0) {
    return { invocations: [], outcomes: [] };
  }

  const { invokeSingleNativeAgentTool, parseToolCallOutcomeFromJson } = await import(
    "../../agentNativeLlm.js"
  );
  const outcomes: ScheduledToolOutcome[] = [];

  for (const inv of invocations) {
    try {
      const result = await invokeSingleNativeAgentTool({
        organizationId: input.organizationId,
        bot: input.bot,
        conversation: input.conversation,
        message: input.message,
        log: input.log,
        behaviorConfig: input.behaviorConfig,
        toolName: inv.toolName,
        args: inv.args,
        userMessage: input.userMessage,
        kbPrefetchAppendix: input.kbPrefetchAppendix,
      });
      const parsed = parseToolCallOutcomeFromJson(result.outcomeName, result.rawJson);
      outcomes.push({
        ...parsed,
        scheduled: true,
      });
    } catch (err) {
      const preview = err instanceof Error ? err.message : "scheduler_invoke_failed";
      input.log.warn({ err, tool: inv.toolName }, "Tool Scheduler invoke failed");
      outcomes.push({
        name: inv.toolName,
        ok: false,
        preview,
        scheduled: true,
      });
    }
  }

  return { invocations, outcomes };
}
