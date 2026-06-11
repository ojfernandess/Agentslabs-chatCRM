import { Prisma, type AutomationLogLevel } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { redactAutomationToolConfig } from "./automationWebhookBundle.js";
import { newWebhookToken } from "./knowledgeSourceService.js";
import { reindexAllKnowledgeArticlesForOrg } from "./knowledgeReindex.js";
import { generateChatbotPublicId } from "./chatbotFlowExecutor.js";

export const AUTOMATION_CONFIG_EXPORT_VERSION = 1;
const MAX_HISTORY_ROWS = 10_000;

function asJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

function redactLlmConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object") return {};
  const c = { ...(config as Record<string, unknown>) };
  if ("apiKey" in c && c.apiKey) c.apiKey = "***";
  return c;
}

function isRedactedSecret(v: unknown): boolean {
  return v === "***" || v === "" || v == null;
}

function remapBehaviorToolIds(behavior: unknown, toolMap: Map<string, string>): unknown {
  if (!behavior || typeof behavior !== "object") return behavior;
  const b = { ...(behavior as Record<string, unknown>) };
  if (Array.isArray(b.connectedTools)) {
    b.connectedTools = b.connectedTools.map((x) => {
      if (!x || typeof x !== "object") return x;
      const t = { ...(x as Record<string, unknown>) };
      const id = String(t.toolId ?? "");
      if (id && toolMap.has(id)) t.toolId = toolMap.get(id);
      return t;
    });
  }
  return b;
}

export type AutomationConfigExportBundle = {
  version: number;
  exportedAt: string;
  config: {
    promptModules: Array<{
      exportKey: string;
      name: string;
      slug: string;
      body: string;
      version: number;
      labels: unknown;
    }>;
    knowledgeSources: Array<{
      exportKey: string;
      kind: string;
      name: string;
      config: unknown;
      isActive: boolean;
    }>;
    knowledgeArticles: Array<{
      exportKey: string;
      sourceExportKey: string | null;
      title: string;
      content: string;
      category: string | null;
      tags: string[];
      isActive: boolean;
      syncToAi: boolean;
      sourceFileName: string | null;
      sourceMimeType: string | null;
    }>;
    knowledgeArticleBotLinks: Array<{ articleExportKey: string; botExportKey: string }>;
    agents: Array<{
      exportKey: string;
      bot: {
        name: string;
        description: string | null;
        isActive: boolean;
        webhookUrl: string | null;
        config: unknown;
        automationManaged: boolean;
      };
      llmConfig: Record<string, unknown>;
      behaviorConfig: unknown;
      promptModuleSlugs: string[];
    }>;
    customTools: Array<{
      exportKey: string;
      botExportKey: string | null;
      name: string;
      description: string;
      toolType: string;
      config: Record<string, unknown>;
      parametersSchema: unknown;
      isActive: boolean;
      tags: string[];
    }>;
    toolExecutions: Array<{
      exportKey: string;
      toolExportKey: string;
      botExportKey: string | null;
      source: string;
      ok: boolean;
      statusCode: number | null;
      durationMs: number | null;
      requestSummary: unknown;
      responseSummary: unknown;
      errorMessage: string | null;
      tokensUsed: number | null;
      createdAt: string;
    }>;
    chatbotFlows: Array<{
      exportKey: string;
      linkedBotExportKey: string | null;
      name: string;
      description: string | null;
      isPublished: boolean;
      flowDefinition: unknown;
      variables: unknown;
      theme: unknown;
      settings: unknown;
    }>;
    interactions: Array<{
      exportKey: string;
      botExportKey: string;
      conversationExportKey: string | null;
      userMessage: string;
      assistantMessage: string;
      metadata: unknown;
      knowledgeArticleExportKeys: string[];
      escalatedToHuman: boolean;
      responseType: string | null;
      createdAt: string;
    }>;
    executions: Array<{
      exportKey: string;
      botExportKey: string;
      conversationExportKey: string | null;
      triggerMessageExportKey: string | null;
      workflowKey: string;
      workflowName: string;
      status: string;
      errorMessage: string | null;
      startedAt: string;
      finishedAt: string | null;
      logEntries: Array<{
        sequence: number;
        level: AutomationLogLevel;
        nodeId: string;
        nodeName: string;
        nodePath: string;
        message: string;
        inputContext: unknown;
        outputContext: unknown;
        stackTrace: string | null;
        createdAt: string;
      }>;
    }>;
    executionLogSettings: {
      retentionDays: number;
      minPersistLevel: AutomationLogLevel;
      alertWebhookUrl: string | null;
      alertEmail: string | null;
      alertMinLevel: AutomationLogLevel;
    } | null;
  };
};

const importBundleSchema = z.object({
  version: z.number().int().positive().optional(),
  exportedAt: z.string().optional(),
  config: z.object({
    promptModules: z.array(z.record(z.unknown())).default([]),
    knowledgeSources: z.array(z.record(z.unknown())).default([]),
    knowledgeArticles: z.array(z.record(z.unknown())).default([]),
    knowledgeArticleBotLinks: z.array(z.record(z.unknown())).default([]),
    agents: z.array(z.record(z.unknown())).default([]),
    customTools: z.array(z.record(z.unknown())).default([]),
    toolExecutions: z.array(z.record(z.unknown())).default([]),
    chatbotFlows: z.array(z.record(z.unknown())).default([]),
    interactions: z.array(z.record(z.unknown())).default([]),
    executions: z.array(z.record(z.unknown())).default([]),
    executionLogSettings: z.record(z.unknown()).nullable().optional(),
  }),
});

export type AutomationConfigImportResult = {
  ok: true;
  mode: "merge" | "replace";
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  warnings: string[];
};

export async function exportAutomationConfig(
  organizationId: string,
): Promise<AutomationConfigExportBundle> {
  const [
    promptModules,
    knowledgeSources,
    knowledgeArticles,
    articleBotLinks,
    agentProfiles,
    customTools,
    toolExecutions,
    chatbotFlows,
    interactions,
    executions,
    executionLogSettings,
  ] = await Promise.all([
    prisma.automationPromptModule.findMany({ where: { organizationId }, orderBy: { slug: "asc" } }),
    prisma.automationKnowledgeSource.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.automationKnowledgeArticle.findMany({ where: { organizationId }, orderBy: { title: "asc" } }),
    prisma.automationKnowledgeArticleBot.findMany({
      where: { article: { organizationId } },
      select: { articleId: true, botId: true },
    }),
    prisma.automationAgentProfile.findMany({
      where: { organizationId },
      include: {
        bot: {
          select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
            webhookUrl: true,
            config: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.automationCustomTool.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.automationToolExecution.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_ROWS,
    }),
    prisma.chatbotFlow.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.automationInteraction.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_ROWS,
    }),
    prisma.automationExecution.findMany({
      where: { organizationId },
      orderBy: { startedAt: "desc" },
      take: MAX_HISTORY_ROWS,
      include: { logEntries: { orderBy: { sequence: "asc" } } },
    }),
    prisma.automationExecutionLogSettings.findUnique({ where: { organizationId } }),
  ]);

  const promptSlugById = new Map(promptModules.map((p) => [p.id, p.slug]));

  return {
    version: AUTOMATION_CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config: {
      promptModules: promptModules.map((p) => ({
        exportKey: p.id,
        name: p.name,
        slug: p.slug,
        body: p.body,
        version: p.version,
        labels: p.labels,
      })),
      knowledgeSources: knowledgeSources.map((s) => {
        const cfg =
          s.config && typeof s.config === "object"
            ? { ...(s.config as Record<string, unknown>) }
            : {};
        if ("webhookToken" in cfg) delete cfg.webhookToken;
        return {
          exportKey: s.id,
          kind: s.kind,
          name: s.name,
          config: cfg,
          isActive: s.isActive,
        };
      }),
      knowledgeArticles: knowledgeArticles.map((a) => ({
        exportKey: a.id,
        sourceExportKey: a.knowledgeSourceId,
        title: a.title,
        content: a.content,
        category: a.category,
        tags: a.tags,
        isActive: a.isActive,
        syncToAi: a.syncToAi,
        sourceFileName: a.sourceFileName,
        sourceMimeType: a.sourceMimeType,
      })),
      knowledgeArticleBotLinks: articleBotLinks.map((l) => ({
        articleExportKey: l.articleId,
        botExportKey: l.botId,
      })),
      agents: agentProfiles.map((p) => {
        const cfg = p.bot.config;
        const automationManaged =
          cfg != null &&
          typeof cfg === "object" &&
          (cfg as Record<string, unknown>).automationManagedByOpenConduit === true;
        const promptIds = Array.isArray(p.promptModuleIds)
          ? (p.promptModuleIds as string[])
          : [];
        return {
          exportKey: p.botId,
          bot: {
            name: p.bot.name,
            description: p.bot.description,
            isActive: p.bot.isActive,
            webhookUrl: p.bot.webhookUrl,
            config: cfg,
            automationManaged,
          },
          llmConfig: redactLlmConfig(p.llmConfig),
          behaviorConfig: p.behaviorConfig,
          promptModuleSlugs: promptIds
            .map((id) => promptSlugById.get(id))
            .filter((s): s is string => Boolean(s)),
        };
      }),
      customTools: customTools.map((t) => ({
        exportKey: t.id,
        botExportKey: t.botId,
        name: t.name,
        description: t.description,
        toolType: t.toolType,
        config: redactAutomationToolConfig(t.config),
        parametersSchema: t.parametersSchema,
        isActive: t.isActive,
        tags: t.tags,
      })),
      toolExecutions: toolExecutions.map((e) => ({
        exportKey: e.id,
        toolExportKey: e.toolId,
        botExportKey: e.botId,
        source: e.source,
        ok: e.ok,
        statusCode: e.statusCode,
        durationMs: e.durationMs,
        requestSummary: e.requestSummary,
        responseSummary: e.responseSummary,
        errorMessage: e.errorMessage,
        tokensUsed: e.tokensUsed,
        createdAt: e.createdAt.toISOString(),
      })),
      chatbotFlows: chatbotFlows.map((f) => ({
        exportKey: f.id,
        linkedBotExportKey: f.linkedBotId,
        name: f.name,
        description: f.description,
        isPublished: f.isPublished,
        flowDefinition: f.flowDefinition,
        variables: f.variables,
        theme: f.theme,
        settings: f.settings,
      })),
      interactions: interactions.map((i) => {
        const articleIds = Array.isArray(i.knowledgeArticleIds)
          ? (i.knowledgeArticleIds as string[])
          : [];
        return {
          exportKey: i.id,
          botExportKey: i.botId,
          conversationExportKey: i.conversationId,
          userMessage: i.userMessage,
          assistantMessage: i.assistantMessage,
          metadata: i.metadata,
          knowledgeArticleExportKeys: articleIds,
          escalatedToHuman: i.escalatedToHuman,
          responseType: i.responseType,
          createdAt: i.createdAt.toISOString(),
        };
      }),
      executions: executions.map((e) => ({
        exportKey: e.id,
        botExportKey: e.botId,
        conversationExportKey: e.conversationId,
        triggerMessageExportKey: e.triggerMessageId,
        workflowKey: e.workflowKey,
        workflowName: e.workflowName,
        status: e.status,
        errorMessage: e.errorMessage,
        startedAt: e.startedAt.toISOString(),
        finishedAt: e.finishedAt?.toISOString() ?? null,
        logEntries: e.logEntries.map((le) => ({
          sequence: le.sequence,
          level: le.level,
          nodeId: le.nodeId,
          nodeName: le.nodeName,
          nodePath: le.nodePath,
          message: le.message,
          inputContext: le.inputContext,
          outputContext: le.outputContext,
          stackTrace: le.stackTrace,
          createdAt: le.createdAt.toISOString(),
        })),
      })),
      executionLogSettings: executionLogSettings
        ? {
            retentionDays: executionLogSettings.retentionDays,
            minPersistLevel: executionLogSettings.minPersistLevel,
            alertWebhookUrl: executionLogSettings.alertWebhookUrl,
            alertEmail: executionLogSettings.alertEmail,
            alertMinLevel: executionLogSettings.alertMinLevel,
          }
        : null,
    },
  };
}

export async function importAutomationConfig(
  organizationId: string,
  raw: unknown,
  mode: "merge" | "replace" = "merge",
): Promise<AutomationConfigImportResult> {
  const parsed = importBundleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid_bundle: ${parsed.error.message}`);
  }
  if (
    parsed.data.version != null &&
    parsed.data.version > AUTOMATION_CONFIG_EXPORT_VERSION
  ) {
    throw new Error(`unsupported_version: ${parsed.data.version}`);
  }

  const cfg = parsed.data.config;
  const created: Record<string, number> = {};
  const updated: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const warnings: string[] = [];
  const bump = (bucket: Record<string, number>, key: string, n = 1) => {
    bucket[key] = (bucket[key] ?? 0) + n;
  };

  const botMap = new Map<string, string>();
  const articleMap = new Map<string, string>();
  const toolMap = new Map<string, string>();
  const sourceMap = new Map<string, string>();
  const promptSlugToId = new Map<string, string>();
  await prisma.$transaction(async (tx) => {
    if (mode === "replace") {
      await tx.automationExecutionLogEntry.deleteMany({
        where: { execution: { organizationId } },
      });
      await tx.automationExecution.deleteMany({ where: { organizationId } });
      await tx.automationInteraction.deleteMany({ where: { organizationId } });
      await tx.automationToolExecution.deleteMany({ where: { organizationId } });
      await tx.automationConversationContext.deleteMany({ where: { organizationId } });
      await tx.automationKnowledgeArticleBot.deleteMany({
        where: { article: { organizationId } },
      });
      await tx.automationKnowledgeChunk.deleteMany({
        where: { organizationId },
      });
      await tx.automationKnowledgeRevision.deleteMany({
        where: { article: { organizationId } },
      });
      await tx.automationKnowledgeArticle.deleteMany({ where: { organizationId } });
      await tx.automationKnowledgeSource.deleteMany({ where: { organizationId } });
      await tx.automationCustomTool.deleteMany({ where: { organizationId } });
      await tx.chatbotFlowSession.deleteMany({ where: { organizationId } });
      await tx.chatbotFlow.deleteMany({ where: { organizationId } });

      const managedProfiles = await tx.automationAgentProfile.findMany({
        where: { organizationId },
        include: { bot: { select: { id: true, config: true } } },
      });
      const managedBotIds = managedProfiles
        .filter(
          (p) =>
            p.bot.config &&
            typeof p.bot.config === "object" &&
            (p.bot.config as Record<string, unknown>).automationManagedByOpenConduit === true,
        )
        .map((p) => p.botId);
      await tx.automationAgentProfile.deleteMany({ where: { organizationId } });
      if (managedBotIds.length) {
        await tx.bot.deleteMany({ where: { id: { in: managedBotIds }, organizationId } });
      }
      await tx.automationPromptModule.deleteMany({ where: { organizationId } });
    }

    for (const rawPm of cfg.promptModules) {
      const slug = String(rawPm.slug ?? "").trim();
      if (!slug) {
        bump(skipped, "promptModules");
        continue;
      }
      const existing = await tx.automationPromptModule.findUnique({
        where: { organizationId_slug: { organizationId, slug } },
      });
      const data = {
        name: String(rawPm.name ?? slug).trim(),
        body: String(rawPm.body ?? ""),
        version: Number(rawPm.version) || 1,
        labels: rawPm.labels == null ? undefined : asJson(rawPm.labels),
      };
      if (existing) {
        const row = await tx.automationPromptModule.update({
          where: { id: existing.id },
          data,
        });
        promptSlugToId.set(slug, row.id);
        if (rawPm.exportKey) promptSlugToId.set(String(rawPm.exportKey), row.id);
        bump(updated, "promptModules");
      } else {
        const row = await tx.automationPromptModule.create({
          data: { organizationId, slug, ...data },
        });
        promptSlugToId.set(slug, row.id);
        if (rawPm.exportKey) promptSlugToId.set(String(rawPm.exportKey), row.id);
        bump(created, "promptModules");
      }
    }

    for (const rawSrc of cfg.knowledgeSources) {
      const name = String(rawSrc.name ?? "").trim();
      const kind = String(rawSrc.kind ?? "manual").trim();
      if (!name) {
        bump(skipped, "knowledgeSources");
        continue;
      }
      const existing = await tx.automationKnowledgeSource.findFirst({
        where: { organizationId, name, kind },
      });
      const config = rawSrc.config ?? {};
      const webhookToken = kind === "webhook_push" ? newWebhookToken() : null;
      if (existing) {
        const row = await tx.automationKnowledgeSource.update({
          where: { id: existing.id },
          data: {
            config: asJson(config),
            isActive: rawSrc.isActive !== false,
            ...(webhookToken ? { webhookToken } : {}),
          },
        });
        if (rawSrc.exportKey) sourceMap.set(String(rawSrc.exportKey), row.id);
        bump(updated, "knowledgeSources");
      } else {
        const row = await tx.automationKnowledgeSource.create({
          data: {
            organizationId,
            kind,
            name,
            config: asJson(config),
            isActive: rawSrc.isActive !== false,
            webhookToken,
          },
        });
        if (rawSrc.exportKey) sourceMap.set(String(rawSrc.exportKey), row.id);
        bump(created, "knowledgeSources");
      }
    }

    for (const rawArt of cfg.knowledgeArticles) {
      const title = String(rawArt.title ?? "").trim();
      if (!title) {
        bump(skipped, "knowledgeArticles");
        continue;
      }
      const sourceExportKey = rawArt.sourceExportKey ? String(rawArt.sourceExportKey) : null;
      const knowledgeSourceId = sourceExportKey ? sourceMap.get(sourceExportKey) ?? null : null;
      const existing = await tx.automationKnowledgeArticle.findFirst({
        where: { organizationId, title },
      });
      const data = {
        title,
        content: String(rawArt.content ?? ""),
        category: rawArt.category ? String(rawArt.category) : null,
        tags: Array.isArray(rawArt.tags) ? rawArt.tags.map(String) : [],
        isActive: rawArt.isActive !== false,
        syncToAi: rawArt.syncToAi !== false,
        sourceFileName: rawArt.sourceFileName ? String(rawArt.sourceFileName) : null,
        sourceMimeType: rawArt.sourceMimeType ? String(rawArt.sourceMimeType) : null,
        knowledgeSourceId,
      };
      if (existing) {
        const row = await tx.automationKnowledgeArticle.update({
          where: { id: existing.id },
          data,
        });
        if (rawArt.exportKey) articleMap.set(String(rawArt.exportKey), row.id);
        bump(updated, "knowledgeArticles");
      } else {
        const row = await tx.automationKnowledgeArticle.create({
          data: { organizationId, ...data },
        });
        if (rawArt.exportKey) articleMap.set(String(rawArt.exportKey), row.id);
        bump(created, "knowledgeArticles");
      }
    }

    const pendingAgents: Array<{
      rawAgent: Record<string, unknown>;
      botName: string;
    }> = [];

    for (const rawAgent of cfg.agents) {
      const botRaw = rawAgent.bot as Record<string, unknown> | undefined;
      const botName = String(botRaw?.name ?? "").trim();
      if (!botName) {
        bump(skipped, "agents");
        continue;
      }
      let bot = await tx.bot.findFirst({ where: { organizationId, name: botName } });
      const automationManaged = botRaw?.automationManaged === true;
      if (!bot) {
        bot = await tx.bot.create({
          data: {
            organizationId,
            name: botName,
            description: botRaw?.description ? String(botRaw.description) : null,
            type: "WEBHOOK",
            webhookUrl: botRaw?.webhookUrl ? String(botRaw.webhookUrl) : null,
            isActive: botRaw?.isActive !== false,
            config: asJson(
              automationManaged
                ? { ...(botRaw?.config as object), automationManagedByOpenConduit: true }
                : (botRaw?.config ?? { automationManagedByOpenConduit: true }),
            ),
          },
        });
        bump(created, "bots");
      } else if (mode === "merge") {
        await tx.bot.update({
          where: { id: bot.id },
          data: {
            description: botRaw?.description ? String(botRaw.description) : bot.description,
            isActive: botRaw?.isActive !== false,
          },
        });
        bump(updated, "bots");
      }
      if (rawAgent.exportKey) botMap.set(String(rawAgent.exportKey), bot.id);
      pendingAgents.push({ rawAgent: rawAgent as Record<string, unknown>, botName });
    }

    for (const rawTool of cfg.customTools) {
      const name = String(rawTool.name ?? "").trim();
      if (!name) {
        bump(skipped, "customTools");
        continue;
      }
      const botExportKey = rawTool.botExportKey ? String(rawTool.botExportKey) : null;
      const botId = botExportKey ? botMap.get(botExportKey) ?? null : null;
      const existing = await tx.automationCustomTool.findFirst({
        where: { organizationId, name, botId: botId ?? null },
      });
      const incomingCfg = redactAutomationToolConfig(rawTool.config);
      let mergedCfg = incomingCfg;
      if (existing?.config && typeof existing.config === "object") {
        mergedCfg = { ...(existing.config as Record<string, unknown>) };
        for (const [k, v] of Object.entries(incomingCfg)) {
          if (!isRedactedSecret(v)) mergedCfg[k] = v;
        }
      }
      const data = {
        name,
        description: String(rawTool.description ?? ""),
        toolType: String(rawTool.toolType ?? "http"),
        config: asJson(mergedCfg),
        parametersSchema: asJson(rawTool.parametersSchema ?? {}),
        isActive: rawTool.isActive !== false,
        tags: Array.isArray(rawTool.tags) ? rawTool.tags.map(String) : [],
        botId,
      };
      if (existing) {
        const row = await tx.automationCustomTool.update({ where: { id: existing.id }, data });
        if (rawTool.exportKey) toolMap.set(String(rawTool.exportKey), row.id);
        bump(updated, "customTools");
      } else {
        const row = await tx.automationCustomTool.create({
          data: { organizationId, ...data },
        });
        if (rawTool.exportKey) toolMap.set(String(rawTool.exportKey), row.id);
        bump(created, "customTools");
      }
    }

    for (const link of cfg.knowledgeArticleBotLinks) {
      const articleId = articleMap.get(String(link.articleExportKey ?? ""));
      const botId = botMap.get(String(link.botExportKey ?? ""));
      if (!articleId || !botId) continue;
      await tx.automationKnowledgeArticleBot.upsert({
        where: { articleId_botId: { articleId, botId } },
        create: { articleId, botId },
        update: {},
      });
      bump(created, "knowledgeArticleBotLinks");
    }

    for (const { rawAgent } of pendingAgents) {
      const botId = rawAgent.exportKey ? botMap.get(String(rawAgent.exportKey)) : undefined;
      if (!botId) continue;

      const slugs = Array.isArray(rawAgent.promptModuleSlugs)
        ? rawAgent.promptModuleSlugs.map(String)
        : [];
      const promptModuleIds = slugs
        .map((s) => promptSlugToId.get(s))
        .filter((id): id is string => Boolean(id));

      const incomingLlm = (rawAgent.llmConfig ?? {}) as Record<string, unknown>;
      const existingProfile = await tx.automationAgentProfile.findUnique({
        where: { botId },
      });
      let llmConfig: Record<string, unknown> = existingProfile
        ? (existingProfile.llmConfig as Record<string, unknown>)
        : { provider: "openai", model: "gpt-4o-mini", temperature: 0.7, maxTokens: 1024 };
      if (incomingLlm && typeof incomingLlm === "object") {
        const patch = { ...incomingLlm };
        if (isRedactedSecret(patch.apiKey)) delete patch.apiKey;
        llmConfig = { ...llmConfig, ...patch };
      }

      const behaviorConfig = remapBehaviorToolIds(
        rawAgent.behaviorConfig ?? existingProfile?.behaviorConfig ?? {},
        toolMap,
      );

      await tx.automationAgentProfile.upsert({
        where: { botId },
        create: {
          organizationId,
          botId,
          llmConfig: asJson(llmConfig),
          behaviorConfig: asJson(behaviorConfig),
          promptModuleIds: promptModuleIds.length ? asJson(promptModuleIds) : undefined,
        },
        update: {
          llmConfig: asJson(llmConfig),
          behaviorConfig: asJson(behaviorConfig),
          promptModuleIds: asJson(promptModuleIds),
        },
      });
      bump(existingProfile ? updated : created, "agents");
    }

    for (const rawFlow of cfg.chatbotFlows) {
      const name = String(rawFlow.name ?? "").trim();
      if (!name) {
        bump(skipped, "chatbotFlows");
        continue;
      }
      const linkedBotExportKey = rawFlow.linkedBotExportKey
        ? String(rawFlow.linkedBotExportKey)
        : null;
      const linkedBotId = linkedBotExportKey ? botMap.get(linkedBotExportKey) ?? null : null;
      const existing = await tx.chatbotFlow.findFirst({ where: { organizationId, name } });
      const data = {
        description: rawFlow.description ? String(rawFlow.description) : null,
        isPublished: rawFlow.isPublished === true,
        flowDefinition: asJson(rawFlow.flowDefinition ?? { nodes: [], edges: [] }),
        variables: asJson(rawFlow.variables ?? []),
        theme: rawFlow.theme == null ? undefined : asJson(rawFlow.theme),
        settings: rawFlow.settings == null ? undefined : asJson(rawFlow.settings),
        linkedBotId,
      };
      if (existing) {
        await tx.chatbotFlow.update({ where: { id: existing.id }, data });
        bump(updated, "chatbotFlows");
      } else {
        await tx.chatbotFlow.create({
          data: {
            organizationId,
            name,
            publicId: generateChatbotPublicId(),
            ...data,
          },
        });
        bump(created, "chatbotFlows");
      }
    }

    for (const rawIx of cfg.interactions) {
      const botId = botMap.get(String(rawIx.botExportKey ?? ""));
      if (!botId) {
        bump(skipped, "interactions");
        continue;
      }
      const articleKeys = Array.isArray(rawIx.knowledgeArticleExportKeys)
        ? rawIx.knowledgeArticleExportKeys.map(String)
        : [];
      const knowledgeArticleIds = articleKeys
        .map((k) => articleMap.get(k))
        .filter((id): id is string => Boolean(id));
      const meta =
        rawIx.metadata && typeof rawIx.metadata === "object"
          ? { ...(rawIx.metadata as Record<string, unknown>) }
          : {};
      if (rawIx.conversationExportKey) {
        meta.importedConversationId = String(rawIx.conversationExportKey);
      }
      await tx.automationInteraction.create({
        data: {
          organizationId,
          botId,
          conversationId: null,
          userMessage: String(rawIx.userMessage ?? ""),
          assistantMessage: String(rawIx.assistantMessage ?? ""),
          metadata: asJson(meta),
          knowledgeArticleIds: knowledgeArticleIds.length ? asJson(knowledgeArticleIds) : undefined,
          escalatedToHuman: rawIx.escalatedToHuman === true,
          responseType: rawIx.responseType ? String(rawIx.responseType) : null,
          createdAt: rawIx.createdAt ? new Date(String(rawIx.createdAt)) : undefined,
        },
      });
      bump(created, "interactions");
    }

    for (const rawEx of cfg.executions) {
      const botId = botMap.get(String(rawEx.botExportKey ?? ""));
      if (!botId) {
        bump(skipped, "executions");
        continue;
      }
      const logEntries = Array.isArray(rawEx.logEntries) ? rawEx.logEntries : [];
      const execution = await tx.automationExecution.create({
        data: {
          organizationId,
          botId,
          conversationId: null,
          triggerMessageId: null,
          workflowKey: String(rawEx.workflowKey ?? "native_agent"),
          workflowName: String(rawEx.workflowName ?? ""),
          status: String(rawEx.status ?? "finished"),
          errorMessage: rawEx.errorMessage ? String(rawEx.errorMessage) : null,
          startedAt: rawEx.startedAt ? new Date(String(rawEx.startedAt)) : undefined,
          finishedAt: rawEx.finishedAt ? new Date(String(rawEx.finishedAt)) : null,
        },
      });
      for (const le of logEntries) {
        await tx.automationExecutionLogEntry.create({
          data: {
            executionId: execution.id,
            sequence: Number(le.sequence) || 0,
            level: (String(le.level ?? "INFO") as AutomationLogLevel) || "INFO",
            nodeId: String(le.nodeId ?? ""),
            nodeName: String(le.nodeName ?? ""),
            nodePath: String(le.nodePath ?? ""),
            message: String(le.message ?? ""),
            inputContext: le.inputContext == null ? undefined : asJson(le.inputContext),
            outputContext: le.outputContext == null ? undefined : asJson(le.outputContext),
            stackTrace: le.stackTrace ? String(le.stackTrace) : null,
            createdAt: le.createdAt ? new Date(String(le.createdAt)) : undefined,
          },
        });
      }
      bump(created, "executions");
    }

    for (const rawTe of cfg.toolExecutions) {
      const toolId = toolMap.get(String(rawTe.toolExportKey ?? ""));
      if (!toolId) {
        bump(skipped, "toolExecutions");
        continue;
      }
      const botExportKey = rawTe.botExportKey ? String(rawTe.botExportKey) : null;
      await tx.automationToolExecution.create({
        data: {
          organizationId,
          toolId,
          botId: botExportKey ? botMap.get(botExportKey) ?? null : null,
          source: String(rawTe.source ?? "import"),
          ok: rawTe.ok === true,
          statusCode: rawTe.statusCode != null ? Number(rawTe.statusCode) : null,
          durationMs: rawTe.durationMs != null ? Number(rawTe.durationMs) : null,
          requestSummary:
            rawTe.requestSummary == null ? undefined : asJson(rawTe.requestSummary),
          responseSummary:
            rawTe.responseSummary == null ? undefined : asJson(rawTe.responseSummary),
          errorMessage: rawTe.errorMessage ? String(rawTe.errorMessage) : null,
          tokensUsed: rawTe.tokensUsed != null ? Number(rawTe.tokensUsed) : null,
          createdAt: rawTe.createdAt ? new Date(String(rawTe.createdAt)) : undefined,
        },
      });
      bump(created, "toolExecutions");
    }

    if (cfg.executionLogSettings) {
      const s = cfg.executionLogSettings;
      await tx.automationExecutionLogSettings.upsert({
        where: { organizationId },
        create: {
          organizationId,
          retentionDays: Number(s.retentionDays) || 30,
          minPersistLevel: (String(s.minPersistLevel ?? "DEBUG") as AutomationLogLevel) || "DEBUG",
          alertWebhookUrl: s.alertWebhookUrl ? String(s.alertWebhookUrl) : null,
          alertEmail: s.alertEmail ? String(s.alertEmail) : null,
          alertMinLevel: (String(s.alertMinLevel ?? "ERROR") as AutomationLogLevel) || "ERROR",
        },
        update: {
          retentionDays: Number(s.retentionDays) || 30,
          minPersistLevel: (String(s.minPersistLevel ?? "DEBUG") as AutomationLogLevel) || "DEBUG",
          alertWebhookUrl: s.alertWebhookUrl ? String(s.alertWebhookUrl) : null,
          alertEmail: s.alertEmail ? String(s.alertEmail) : null,
          alertMinLevel: (String(s.alertMinLevel ?? "ERROR") as AutomationLogLevel) || "ERROR",
        },
      });
      bump(updated, "executionLogSettings");
    }
  });

  if ((created.knowledgeArticles ?? 0) + (updated.knowledgeArticles ?? 0) > 0) {
    try {
      await reindexAllKnowledgeArticlesForOrg(organizationId);
    } catch (err) {
      warnings.push(
        err instanceof Error ? err.message : "knowledge_reindex_failed",
      );
    }
  }

  return { ok: true, mode, created, updated, skipped, warnings };
}
