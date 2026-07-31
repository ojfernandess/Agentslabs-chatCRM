import type { FastifyBaseLogger } from "fastify";
import { deliverOutboundWhatsAppMessage } from "../../outboundMessage.js";
import type { AutomationExecutionLogPort } from "../../automationExecutionLog.js";
import {
  parseToolCallNotifyFromBehavior,
  resolveToolCallNotifyBody,
  shouldNotifyBeforeToolCall,
} from "../../agentNativeLlm.js";

/**
 * Envia aviso intermédio antes do Scheduler executar tools (runtime_owned).
 * Em hybrid o aviso corre via onAssistantToolRound; aqui cobre OpenNexo Runtime.
 */
export async function maybeSendInterimNotifyBeforeScheduledTools(opts: {
  organizationId: string;
  botId: string;
  conversationId: string;
  contactId?: string;
  toolNames: string[];
  behaviorConfig: Record<string, unknown>;
  log: FastifyBaseLogger;
  executionLog?: AutomationExecutionLogPort | null;
}): Promise<boolean> {
  if (!opts.contactId || opts.toolNames.length === 0) return false;

  const cfg = parseToolCallNotifyFromBehavior(opts.behaviorConfig);
  if (!cfg.enabled) return false;

  const selected = opts.toolNames.filter((name) => shouldNotifyBeforeToolCall(name, cfg));
  if (selected.length === 0) return false;

  const body = resolveToolCallNotifyBody({
    assistantContent: null,
    toolNames: selected,
    defaultMessage: cfg.message,
    toolMessages: cfg.toolMessages,
  });

  const tlog = opts.executionLog?.child("tools");
  try {
    await deliverOutboundWhatsAppMessage({
      organizationId: opts.organizationId,
      data: {
        contactId: opts.contactId,
        conversationId: opts.conversationId,
        type: "TEXT",
        body,
      },
      actor: { kind: "agent_bot", botId: opts.botId },
      log: opts.log,
      newConversation: { status: "PENDING", assignedToId: null },
    });
    tlog?.info(
      { id: "interim_notify", name: "Aviso intermédio" },
      "Mensagem enviada ao contacto — Scheduler a invocar ferramenta(s)",
      {
        output: {
          round: 0,
          toolNames: selected.slice(0, 8),
          usedAgentStallText: false,
          messagePreview: body.slice(0, 240),
          source: "scheduler",
        },
      },
    );
    return true;
  } catch (err) {
    opts.log.warn({ err, botId: opts.botId, toolNames: selected }, "scheduler interim notify failed");
    tlog?.warn(
      { id: "interim_notify", name: "Aviso intermédio" },
      "Falha ao enviar aviso intermédio (Scheduler)",
      { stack: err instanceof Error ? err.stack : undefined },
    );
    return false;
  }
}
