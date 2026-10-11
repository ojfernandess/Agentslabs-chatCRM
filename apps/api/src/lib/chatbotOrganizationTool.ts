import { prisma } from "../db.js";
import { runAutomationHttpLikeTool, type AutomationHttpToolRow } from "./automationHttpToolExecute.js";
import { runCalComTool } from "./calComToolExecute.js";
import { runGoogleCalendarTool } from "./googleCalendarToolExecute.js";
import { isMercadoPagoAutomationTool, runMercadoPagoTool } from "./mercadoPagoToolExecute.js";
import { isStripeAutomationTool, runStripeTool } from "./stripeToolExecute.js";

/**
 * Runs one organization custom tool from a visual chatbot block.
 * Same runners the native agent already uses. Scoped to the conversation organization.
 */
export async function runChatbotOrganizationTool(input: {
  organizationId: string;
  botId: string;
  conversationId: string;
  toolId: string;
  llmArgs: Record<string, unknown>;
  runtimeSampleContext?: Record<string, unknown>;
}): Promise<{ ok: boolean; text: string; error: string | null }> {
  const toolId = input.toolId.trim();
  if (!toolId) return { ok: false, text: "", error: "missing_tool" };

  const row = await prisma.automationCustomTool.findFirst({
    where: { id: toolId, organizationId: input.organizationId },
  });
  if (!row) return { ok: false, text: "", error: "tool_not_found" };
  if (!row.isActive) return { ok: false, text: "", error: "tool_inactive" };

  const tool: AutomationHttpToolRow = {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    toolType: row.toolType,
    config: row.config,
    parametersSchema: row.parametersSchema,
  };
  const common = {
    tool,
    llmArgs: input.llmArgs,
    organizationId: input.organizationId,
    botId: input.botId,
    conversationId: input.conversationId,
    executionSource: "chatbot_flow",
  };

  const exec =
    tool.toolType === "GOOGLE_CALENDAR"
      ? await runGoogleCalendarTool(common)
      : tool.toolType === "CAL_COM"
        ? await runCalComTool({ ...common, runtimeSampleContext: input.runtimeSampleContext })
        : isStripeAutomationTool(tool)
          ? await runStripeTool(common)
          : isMercadoPagoAutomationTool(tool)
            ? await runMercadoPagoTool(common)
            : await runAutomationHttpLikeTool({
                ...common,
                runtimeSampleContext: input.runtimeSampleContext,
              });

  const raw = exec.ok ? exec.responseText : exec.error || exec.responseText || "";
  return { ok: exec.ok, text: raw.slice(0, 4000), error: exec.error };
}
