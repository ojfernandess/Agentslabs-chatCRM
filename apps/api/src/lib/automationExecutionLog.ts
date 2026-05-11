import { randomUUID } from "node:crypto";
import type { AutomationLogLevel, Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import {
  automationLogSeverityRank,
  type AutomationLogLevelName,
} from "./automationExecutionLogLevel.js";

const MAX_JSON_BYTES = 48_000;
const MAX_STACK = 65_000;

function asLevelName(l: AutomationLogLevel): AutomationLogLevelName {
  return l as AutomationLogLevelName;
}

export type AutomationLogExtra = {
  input?: unknown;
  output?: unknown;
  stack?: string;
};

export type AutomationExecutionLogPort = {
  debug(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void;
  info(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void;
  warn(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void;
  error(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void;
  fatal(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void;
  child(pathSegment: string): AutomationExecutionLogPort;
};

type LogCtx = {
  executionId: string;
  organizationId: string;
  minLevel: AutomationLogLevel;
  alertMinLevel: AutomationLogLevel;
  alertWebhookUrl: string | null;
  alertEmail: string | null;
  nextSequence: () => number;
  logSink: FastifyBaseLogger | null;
};

type BatchRow = {
  id: string;
  executionId: string;
  sequence: number;
  level: AutomationLogLevel;
  nodeId: string;
  nodeName: string;
  nodePath: string;
  message: string;
  inputContext: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
  outputContext: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
  stackTrace: string | null;
};

const globalBuffer: BatchRow[] = [];
let flushScheduled = false;
let flushChain: Promise<void> = Promise.resolve();

function safeJson(input: unknown): Prisma.InputJsonValue | undefined {
  if (input === undefined) return undefined;
  try {
    const s = JSON.stringify(input);
    if (s.length <= MAX_JSON_BYTES) {
      return JSON.parse(s) as Prisma.InputJsonValue;
    }
    return {
      _truncated: true,
      approxBytes: s.length,
      preview: s.slice(0, 4000),
    } as Prisma.InputJsonValue;
  } catch {
    return { _error: "json_stringify_failed" } as Prisma.InputJsonValue;
  }
}

function shouldPersist(level: AutomationLogLevel, min: AutomationLogLevel): boolean {
  return automationLogSeverityRank(asLevelName(level)) >= automationLogSeverityRank(asLevelName(min));
}

function shouldAlert(level: AutomationLogLevel, min: AutomationLogLevel): boolean {
  return automationLogSeverityRank(asLevelName(level)) >= automationLogSeverityRank(asLevelName(min));
}

async function postAlertWebhook(
  url: string,
  body: Record<string, unknown>,
  logSink: FastifyBaseLogger | null,
): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "OpenConduit-AutomationLog/1" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logSink?.warn({ status: res.status, url: url.slice(0, 80) }, "automation execution alert webhook non-OK");
    }
  } catch (err) {
    logSink?.warn({ err, url: url.slice(0, 80) }, "automation execution alert webhook failed");
  } finally {
    clearTimeout(t);
  }
}

function fireAlert(
  ctx: LogCtx,
  payload: {
    level: AutomationLogLevel;
    message: string;
    nodeName: string;
    nodePath: string;
  },
): void {
  if (!shouldAlert(payload.level, ctx.alertMinLevel)) return;
  const base = {
    event: "automation.execution.alert",
    organizationId: ctx.organizationId,
    executionId: ctx.executionId,
    level: payload.level,
    message: payload.message,
    nodeName: payload.nodeName,
    nodePath: payload.nodePath,
    timestamp: new Date().toISOString(),
  };
  if (ctx.alertWebhookUrl) {
    void postAlertWebhook(ctx.alertWebhookUrl, base, ctx.logSink);
  }
  if (ctx.alertEmail?.trim()) {
    ctx.logSink?.info(
      { executionId: ctx.executionId, alertEmail: ctx.alertEmail },
      "automation_execution_log: email alerts require mailer integration — configure webhook or extend with SMTP",
    );
  }
}

export function scheduleAutomationLogFlush(delayMs = 750): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    flushChain = flushChain.then(() => flushAutomationLogBuffer());
  }, delayMs);
}

export async function flushAutomationLogBuffer(): Promise<void> {
  if (globalBuffer.length === 0) return;
  const chunk = globalBuffer.splice(0, globalBuffer.length);
  try {
    await prisma.automationExecutionLogEntry.createMany({ data: chunk });
  } catch (err) {
    // Re-queue on failure (best-effort; may duplicate if partial — rare for createMany)
    globalBuffer.unshift(...chunk);
    throw err;
  }
}

export class AutomationExecutionLogHandle implements AutomationExecutionLogPort {
  constructor(
    private readonly ctx: LogCtx,
    private readonly nodePathPrefix: string,
  ) {}

  child(pathSegment: string): AutomationExecutionLogPort {
    const next = this.nodePathPrefix ? `${this.nodePathPrefix}/${pathSegment}` : pathSegment;
    return new AutomationExecutionLogHandle(this.ctx, next);
  }

  log(level: AutomationLogLevel, node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void {
    if (!shouldPersist(level, this.ctx.minLevel)) return;
    const sequence = this.ctx.nextSequence();
    const nodePath = this.nodePathPrefix ? `${this.nodePathPrefix}/${node.id}` : node.id;
    globalBuffer.push({
      id: randomUUID(),
      executionId: this.ctx.executionId,
      sequence,
      level,
      nodeId: node.id.slice(0, 120),
      nodeName: node.name.slice(0, 200),
      nodePath: nodePath.slice(0, 400),
      message: message.slice(0, 50_000),
      inputContext: safeJson(extra?.input),
      outputContext: safeJson(extra?.output),
      stackTrace: extra?.stack ? extra.stack.slice(0, MAX_STACK) : null,
    });
    fireAlert(this.ctx, { level, message, nodeName: node.name, nodePath });
    scheduleAutomationLogFlush();
  }

  debug(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void {
    this.log("DEBUG", node, message, extra);
  }
  info(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void {
    this.log("INFO", node, message, extra);
  }
  warn(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void {
    this.log("WARN", node, message, extra);
  }
  error(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void {
    this.log("ERROR", node, message, extra);
  }
  fatal(node: { id: string; name: string }, message: string, extra?: AutomationLogExtra): void {
    this.log("FATAL", node, message, extra);
  }

  getExecutionId(): string {
    return this.ctx.executionId;
  }

  async completeSuccess(): Promise<void> {
    await flushAutomationLogBuffer();
    await prisma.automationExecution.update({
      where: { id: this.ctx.executionId },
      data: { status: "success", finishedAt: new Date() },
    });
  }

  async completeError(err: unknown): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? undefined : undefined;
    this.error({ id: "execution", name: "Erro na execução" }, msg, { stack });
    await flushAutomationLogBuffer();
    await prisma.automationExecution.update({
      where: { id: this.ctx.executionId },
      data: {
        status: "error",
        finishedAt: new Date(),
        errorMessage: msg.slice(0, 8000),
      },
    });
  }
}

export async function startAutomationExecution(params: {
  organizationId: string;
  botId: string;
  conversationId?: string | null;
  triggerMessageId?: string | null;
  workflowKey?: string;
  workflowName?: string;
  log?: FastifyBaseLogger | null;
}): Promise<AutomationExecutionLogHandle> {
  const settings = await prisma.automationExecutionLogSettings.findUnique({
    where: { organizationId: params.organizationId },
  });
  let seq = 0;
  const ctx: LogCtx = {
    executionId: "",
    organizationId: params.organizationId,
    minLevel: settings?.minPersistLevel ?? "DEBUG",
    alertMinLevel: settings?.alertMinLevel ?? "ERROR",
    alertWebhookUrl: settings?.alertWebhookUrl?.trim() || null,
    alertEmail: settings?.alertEmail?.trim() || null,
    nextSequence: () => {
      seq += 1;
      return seq;
    },
    logSink: params.log ?? null,
  };
  const wfKey = (params.workflowKey ?? "native_agent").slice(0, 120);
  const wfName = (params.workflowName ?? wfKey).slice(0, 200);
  const exec = await prisma.automationExecution.create({
    data: {
      organizationId: params.organizationId,
      botId: params.botId,
      conversationId: params.conversationId || undefined,
      triggerMessageId: params.triggerMessageId || undefined,
      workflowKey: wfKey,
      workflowName: wfName,
      status: "running",
    },
  });
  ctx.executionId = exec.id;
  return new AutomationExecutionLogHandle(ctx, wfKey);
}

export async function purgeOldAutomationExecutionLogs(log?: FastifyBaseLogger): Promise<void> {
  const settingsRows = await prisma.automationExecutionLogSettings.findMany({
    select: { organizationId: true, retentionDays: true },
  });
  const byOrg = new Map(settingsRows.map((r) => [r.organizationId, r.retentionDays]));
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const { id } of orgs) {
    const days = byOrg.get(id) ?? 30;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const r = await prisma.automationExecution.deleteMany({
      where: { organizationId: id, startedAt: { lt: cutoff } },
    });
    if (r.count > 0) {
      log?.info({ organizationId: id, deletedExecutions: r.count, cutoff: cutoff.toISOString() }, "automation_execution_log_purge");
    }
  }
}

let workerRegistered = false;

export function registerAutomationExecutionLogWorker(log: FastifyBaseLogger): void {
  if (workerRegistered) return;
  workerRegistered = true;
  setInterval(() => {
    flushChain = flushChain.then(() =>
      flushAutomationLogBuffer().catch((err) => log.warn({ err }, "automation log flush failed")),
    );
  }, 1_000);
  const sixHours = 6 * 60 * 60 * 1000;
  setInterval(() => {
    void purgeOldAutomationExecutionLogs(log).catch((err) => log.warn({ err }, "automation log purge failed"));
  }, sixHours);
  void purgeOldAutomationExecutionLogs(log).catch(() => {});
}

export function formatStack(err: unknown): string | undefined {
  if (err instanceof Error) return err.stack ?? err.message;
  return undefined;
}
