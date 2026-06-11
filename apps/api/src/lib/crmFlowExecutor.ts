import type { FastifyBaseLogger } from "fastify";
import type { CrmFlow, CrmFlowExecutionStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { parseCrmFlowDefinition, type CrmFlowDefinition } from "./crmFlowTypes.js";
import { hydrateCrmFlowContext, type CrmFlowContext } from "./crmFlowContext.js";
import { crmFlowTriggerMatches, type CrmFlowTriggerConfig } from "./crmFlowTriggerFilters.js";
import { broadcastCrmFlowExecutionUpdated } from "./crmFlowHooks.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { runCrmAiClassifyBlock } from "./crmFlowAiBlock.js";
import { distributeLeadToUser, type DistributeMethod } from "./crmFlowLeadDistribution.js";
import { broadcastConversationUpdated } from "./workspaceHub.js";
import { appendTimelineEvent } from "./timeline.js";

const silentLog: FastifyBaseLogger = {
  level: "info",
  silent: () => undefined,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => silentLog,
} as FastifyBaseLogger;

function expandVars(text: string, ctx: CrmFlowContext): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = ctx[key];
    return v == null ? "" : String(v);
  });
}

function evalCondition(data: Record<string, unknown>, ctx: CrmFlowContext): boolean {
  const field = String(data.field ?? "name");
  const op = String(data.operator ?? "contains");
  const expected = data.value != null ? String(data.value) : "";
  const actual = ctx[field] != null ? String(ctx[field]) : "";

  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "contains":
      return actual.toLowerCase().includes(expected.toLowerCase());
    case "not_contains":
      return !actual.toLowerCase().includes(expected.toLowerCase());
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "empty":
      return actual.trim() === "";
    case "not_empty":
      return actual.trim() !== "";
    default:
      return true;
  }
}

function computeResumeAt(data: Record<string, unknown>): Date {
  const amount = Math.max(1, Number(data.amount ?? 1));
  const unit = String(data.unit ?? "days");
  const ms =
    unit === "minutes"
      ? amount * 60_000
      : unit === "hours"
        ? amount * 3_600_000
        : amount * 86_400_000;
  return new Date(Date.now() + ms);
}

async function resolveFlowBotId(organizationId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { agentBotId: true },
  });
  if (settings?.agentBotId) {
    const bot = await prisma.bot.findFirst({
      where: { id: settings.agentBotId, organizationId, isActive: true },
      select: { id: true },
    });
    if (bot) return bot.id;
  }
  const fallback = await prisma.bot.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

async function appendLog(
  executionId: string,
  sequence: number,
  entry: {
    nodeId?: string;
    nodeType?: string;
    level?: string;
    message: string;
    inputContext?: CrmFlowContext;
    outputContext?: CrmFlowContext;
  },
): Promise<number> {
  await prisma.crmFlowLogEntry.create({
    data: {
      executionId,
      sequence,
      nodeId: entry.nodeId ?? null,
      nodeType: entry.nodeType ?? null,
      level: entry.level ?? "info",
      message: entry.message,
      inputContext: (entry.inputContext ?? undefined) as Prisma.InputJsonValue | undefined,
      outputContext: (entry.outputContext ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  return sequence + 1;
}

async function runNode(
  node: { id: string; type: string; data?: Record<string, unknown> },
  ctx: CrmFlowContext,
  organizationId: string,
  log: FastifyBaseLogger,
): Promise<CrmFlowContext> {
  const data = node.data ?? {};

  switch (node.type) {
    case "add_tag": {
      const tagId = data.tagId as string | undefined;
      const contactId = ctx.contactId as string | undefined;
      if (tagId && contactId) {
        await prisma.contactTag.upsert({
          where: { contactId_tagId: { contactId, tagId } },
          create: { contactId, tagId },
          update: {},
        });
      }
      return ctx;
    }
    case "remove_tag": {
      const tagId = data.tagId as string | undefined;
      const contactId = ctx.contactId as string | undefined;
      if (tagId && contactId) {
        await prisma.contactTag.deleteMany({ where: { contactId, tagId } });
      }
      return ctx;
    }
    case "assign_user": {
      const userId = data.userId as string | undefined;
      const conversationId = ctx.conversationId as string | undefined;
      const contactId = ctx.contactId as string | undefined;
      if (userId && conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { assignedToId: userId },
        });
        broadcastConversationUpdated(organizationId, conversationId);
      }
      if (userId && contactId) {
        await prisma.contact.update({
          where: { id: contactId },
          data: { assignedToId: userId },
        });
      }
      return { ...ctx, assignedToId: userId, responsavel: userId };
    }
    case "move_stage": {
      const stageId = data.stageId as string | undefined;
      const contactId = ctx.contactId as string | undefined;
      if (stageId && contactId) {
        await prisma.contact.update({
          where: { id: contactId },
          data: { pipelineStageId: stageId },
        });
      }
      return { ...ctx, pipelineStageId: stageId, _skipStageTrigger: true };
    }
    case "send_whatsapp_text": {
      const contactId = ctx.contactId as string | undefined;
      const conversationId = ctx.conversationId as string | undefined;
      const rendered = expandVars(String(data.message ?? ""), ctx).trim();
      if (!contactId || !rendered) return ctx;
      const botId = await resolveFlowBotId(organizationId);
      if (!botId) return { ...ctx, lastWhatsappError: "no_bot" };
      try {
        await deliverOutboundWhatsAppMessage({
          organizationId,
          data: {
            contactId,
            conversationId: conversationId ?? undefined,
            type: "TEXT",
            body: rendered,
          },
          actor: { kind: "agent_bot", botId },
          log,
          newConversation: { status: "OPEN", assignedToId: (ctx.assignedToId as string) ?? null },
          skipCrmFlowTrigger: true,
        });
        return { ...ctx, lastWhatsappMessage: rendered };
      } catch (err) {
        return {
          ...ctx,
          lastWhatsappError: err instanceof Error ? err.message : "send_failed",
        };
      }
    }
    case "create_task": {
      const title = expandVars(String(data.title ?? "Tarefa"), ctx);
      const contactId = (ctx.contactId as string) ?? (data.contactId as string);
      const userId = (data.userId as string) ?? (ctx.assignedToId as string) ?? (ctx.userId as string);
      if (contactId && userId) {
        const desc = data.description ? expandVars(String(data.description), ctx) : "";
        await prisma.reminder.create({
          data: {
            organizationId,
            contactId,
            userId,
            note: desc ? `${title}\n\n${desc}` : title,
            dueAt: data.dueAt ? new Date(String(data.dueAt)) : new Date(Date.now() + 86400000),
          },
        });
      }
      return ctx;
    }
    case "distribute_lead": {
      const contactId = ctx.contactId as string | undefined;
      if (!contactId) return ctx;
      const method = (data.method as DistributeMethod) ?? "least_load";
      const userId = await distributeLeadToUser({
        organizationId,
        contactId,
        method,
        inboxId: ctx.inboxId as string | undefined,
        phone: String(ctx.telefone ?? ctx.phone ?? ""),
        interestText: String(ctx.interesse ?? ctx.detectedInterest ?? ctx.body ?? ""),
        regionMappings: Array.isArray(data.regionMappings)
          ? (data.regionMappings as { ddd: string; userId: string }[])
          : [],
        interestMappings: Array.isArray(data.interestMappings)
          ? (data.interestMappings as { interest: string; userId: string }[])
          : [],
        candidateUserIds: Array.isArray(data.userIds) ? (data.userIds as string[]) : undefined,
      });
      return userId ? { ...ctx, assignedToId: userId } : ctx;
    }
    case "ai_classify":
      return runCrmAiClassifyBlock(organizationId, String(data.mode ?? "lead_temperature"), ctx);
    case "create_callback": {
      const contactId = ctx.contactId as string | undefined;
      const userId =
        (data.userId as string) ?? (ctx.assignedToId as string) ?? (ctx.userId as string);
      const hours = Math.max(1, Number(data.delayHours ?? 2));
      if (contactId && userId) {
        await prisma.reminder.create({
          data: {
            organizationId,
            contactId,
            userId,
            note: expandVars(String(data.note ?? "Retornar ligação"), ctx),
            dueAt: new Date(Date.now() + hours * 3_600_000),
          },
        });
      }
      return ctx;
    }
    case "create_call_log": {
      const contactId = ctx.contactId as string | undefined;
      if (contactId) {
        await appendTimelineEvent({
          organizationId,
          subjectType: "CONTACT",
          subjectId: contactId,
          eventType: "crm_flow_call",
          channel: String(data.channel ?? ctx.provider ?? "CRM"),
          payload: {
            title: expandVars(String(data.title ?? "Registro de chamada (fluxo CRM)"), ctx),
            direction: (ctx.direction as string) ?? data.direction,
            status: (ctx.status as string) ?? data.status,
            phone: (ctx.phone as string) ?? (ctx.telefone as string),
          },
        });
      }
      return ctx;
    }
    case "forward_call":
    case "make_call": {
      const contactId = ctx.contactId as string | undefined;
      const userId =
        (data.userId as string) ?? (ctx.assignedToId as string) ?? (ctx.userId as string);
      if (contactId && userId) {
        const defaultNote =
          node.type === "make_call" ? "Ligar para o contato (fluxo CRM)" : "Encaminhar chamada (fluxo CRM)";
        await prisma.reminder.create({
          data: {
            organizationId,
            contactId,
            userId,
            note: expandVars(String(data.note ?? defaultNote), ctx),
            dueAt: new Date(Date.now() + 15 * 60_000),
          },
        });
      }
      return { ...ctx, telephonyAction: node.type };
    }
    case "wait":
    case "condition":
      return ctx;
    default:
      return ctx;
  }
}

function nextNodeId(flow: CrmFlowDefinition, currentId: string, branch?: string): string | null {
  const edge = flow.edges.find(
    (e) => e.source === currentId && (branch == null || e.branch === branch || e.branch == null),
  );
  return edge?.target ?? null;
}

export type ExecuteCrmFlowResult = {
  executionId: string;
  status: CrmFlowExecutionStatus;
  waiting?: boolean;
};

export async function continueCrmFlowExecution(params: {
  flow: CrmFlow;
  organizationId: string;
  executionId: string;
  startNodeId: string;
  ctx: CrmFlowContext;
  triggerType: string;
  log?: FastifyBaseLogger;
}): Promise<ExecuteCrmFlowResult> {
  return runFlowGraph({
    flow: params.flow,
    organizationId: params.organizationId,
    triggerType: params.triggerType,
    executionId: params.executionId,
    startNodeId: params.startNodeId,
    initialCtx: params.ctx,
    log: params.log ?? silentLog,
  });
}

async function runFlowGraph(params: {
  flow: CrmFlow;
  organizationId: string;
  triggerType: string;
  executionId?: string;
  startNodeId?: string;
  initialCtx?: CrmFlowContext;
  log: FastifyBaseLogger;
}): Promise<ExecuteCrmFlowResult> {
  const { flow, organizationId, triggerType, log } = params;
  const definition = parseCrmFlowDefinition(flow.flowDefinition);
  const startedAt = Date.now();

  let executionId = params.executionId;
  if (!executionId) {
    const execution = await prisma.crmFlowExecution.create({
      data: {
        organizationId,
        crmFlowId: flow.id,
        triggerType,
        triggerPayload: (params.initialCtx ?? {}) as Prisma.InputJsonValue,
        status: "RUNNING",
      },
    });
    executionId = execution.id;
    broadcastCrmFlowExecutionUpdated(organizationId, executionId, flow.id, "RUNNING");
  } else {
    await prisma.crmFlowExecution.update({
      where: { id: executionId },
      data: { status: "RUNNING" },
    });
    broadcastCrmFlowExecutionUpdated(organizationId, executionId, flow.id, "RUNNING");
  }

  let ctx = params.initialCtx ?? {};
  let seq =
    (await prisma.crmFlowLogEntry.count({ where: { executionId } })) || 0;
  let status: CrmFlowExecutionStatus = "SUCCESS";
  let errorMessage: string | null = null;
  let waiting = false;

  try {
    const startId =
      params.startNodeId ??
      definition.nodes.find((n) => n.type === "trigger")?.id ??
      definition.nodes[0]?.id;
    if (!startId) throw new Error("Flow has no nodes");

    let currentId: string | null = startId;
    const visited = new Set<string>();

    for (let step = 0; step < 100 && currentId; step++) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node = definition.nodes.find((n) => n.id === currentId);
      if (!node) break;

      if (node.type === "end") {
        seq = await appendLog(executionId, seq, {
          nodeId: node.id,
          nodeType: "end",
          message: "Flow completed",
          outputContext: ctx,
        });
        break;
      }

      if (node.type === "condition") {
        const pass = evalCondition(node.data ?? {}, ctx);
        seq = await appendLog(executionId, seq, {
          nodeId: node.id,
          nodeType: "condition",
          message: pass ? "Condition passed" : "Condition failed",
          inputContext: node.data,
          outputContext: { result: pass },
        });
        currentId = nextNodeId(definition, node.id, pass ? "yes" : "no");
        continue;
      }

      if (node.type === "wait") {
        const resumeAt = computeResumeAt(node.data ?? {});
        const nextId = nextNodeId(definition, node.id);
        if (nextId) {
          await prisma.crmFlowWaitJob.upsert({
            where: { executionId },
            create: {
              organizationId,
              crmFlowId: flow.id,
              executionId,
              nextNodeId: nextId,
              context: ctx as Prisma.InputJsonValue,
              resumeAt,
            },
            update: { nextNodeId: nextId, context: ctx as Prisma.InputJsonValue, resumeAt },
          });
          status = "WAITING";
          waiting = true;
          seq = await appendLog(executionId, seq, {
            nodeId: node.id,
            nodeType: "wait",
            message: `Waiting until ${resumeAt.toISOString()}`,
            outputContext: { resumeAt: resumeAt.toISOString() },
          });
        }
        break;
      }

      if (node.type !== "trigger") {
        ctx = await runNode(node, ctx, organizationId, log);
        seq = await appendLog(executionId, seq, {
          nodeId: node.id,
          nodeType: node.type,
          message: `Executed ${node.type}`,
          outputContext: ctx,
        });
      }

      currentId = nextNodeId(definition, node.id);
    }
  } catch (err) {
    status = "FAILED";
    errorMessage = err instanceof Error ? err.message : "execution_failed";
    seq = await appendLog(executionId, seq, { level: "error", message: errorMessage });
  }

  const durationMs = Date.now() - startedAt;
  await prisma.crmFlowExecution.update({
    where: { id: executionId },
    data: {
      status,
      finishedAt: waiting ? null : new Date(),
      durationMs: waiting ? null : durationMs,
      errorMessage,
    },
  });

  if (!waiting) {
    await prisma.crmFlow.update({
      where: { id: flow.id },
      data: { lastExecutedAt: new Date(), executionCount: { increment: 1 } },
    });
  }

  broadcastCrmFlowExecutionUpdated(organizationId, executionId, flow.id, status);
  return { executionId, status, waiting };
}

export async function executeCrmFlow(params: {
  flow: CrmFlow;
  organizationId: string;
  triggerType: string;
  triggerPayload?: CrmFlowContext;
  log?: FastifyBaseLogger;
}): Promise<ExecuteCrmFlowResult> {
  const hydrated = await hydrateCrmFlowContext(
    params.organizationId,
    params.triggerPayload ?? {},
  );
  return runFlowGraph({
    flow: params.flow,
    organizationId: params.organizationId,
    triggerType: params.triggerType,
    initialCtx: hydrated,
    log: params.log ?? silentLog,
  });
}

export async function dispatchCrmFlowTrigger(params: {
  organizationId: string;
  triggerType: string;
  payload?: CrmFlowContext;
  log?: FastifyBaseLogger;
}): Promise<void> {
  const flows = await prisma.crmFlow.findMany({
    where: {
      organizationId: params.organizationId,
      status: "ACTIVE",
      isPublished: true,
    },
  });

  const hydrated = await hydrateCrmFlowContext(params.organizationId, params.payload ?? {});

  for (const flow of flows) {
    const config = flow.triggerConfig as CrmFlowTriggerConfig | null;
    if (!crmFlowTriggerMatches(config, params.triggerType, hydrated)) continue;
    await executeCrmFlow({
      flow,
      organizationId: params.organizationId,
      triggerType: params.triggerType,
      triggerPayload: hydrated,
      log: params.log,
    });
  }
}
