import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { assertHttpUrlAllowed, truncateBody } from "./httpToolTest.js";
import { secureHttpFetch } from "./secureHttpFetch.js";
import { extractHtmlTitle, htmlToPlainText } from "./knowledgeWebExtract.js";
import { reindexKnowledgeArticle } from "./knowledgeReindex.js";

export const KB_SOURCE_KINDS = [
  "web_url",
  "webhook_push",
  "gdrive",
  "notion",
  "web",
  "confluence",
  "zendesk",
  "github",
] as const;

export type KbSourceKind = (typeof KB_SOURCE_KINDS)[number];

const STUB_KINDS = new Set<string>(["gdrive", "notion", "web", "confluence", "zendesk", "github"]);

const MAX_FETCH_BYTES = 2_000_000;

function zodUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function isStubKind(kind: string): boolean {
  return STUB_KINDS.has(kind);
}

export function redactSourceForClient<T extends { webhookToken: string | null }>(
  row: T,
): Omit<T, "webhookToken"> & { webhookConfigured: boolean } {
  const { webhookToken, ...rest } = row;
  return { ...rest, webhookConfigured: Boolean(webhookToken) };
}

export async function syncKnowledgeSource(params: {
  sourceId: string;
  organizationId: string;
}): Promise<{ ok: true; articleId: string | null; message: string } | { ok: false; code: string; message: string }> {
  const source = await prisma.automationKnowledgeSource.findFirst({
    where: { id: params.sourceId, organizationId: params.organizationId },
  });
  if (!source) {
    return { ok: false, code: "not_found", message: "Source not found" };
  }
  if (!source.isActive) {
    return { ok: false, code: "inactive", message: "Source is inactive" };
  }

  if (isStubKind(source.kind)) {
    await prisma.automationKnowledgeSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "skipped",
        lastSyncMessage: "Connector not implemented in this version — configure credentials in a future release.",
      },
    });
    return {
      ok: true,
      articleId: null,
      message: "Stub source recorded; full sync requires a future connector.",
    };
  }

  if (source.kind === "webhook_push") {
    await prisma.automationKnowledgeSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "idle",
        lastSyncMessage: "Webhook sources update when your system POSTs to the push URL.",
      },
    });
    return { ok: true, articleId: null, message: "Waiting for webhook payloads." };
  }

  if (source.kind !== "web_url") {
    return { ok: false, code: "unsupported", message: `Unsupported kind: ${source.kind}` };
  }

  const cfg = source.config as Record<string, unknown>;
  const rawUrl = typeof cfg.url === "string" ? cfg.url.trim() : "";
  if (!rawUrl) {
    await prisma.automationKnowledgeSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "error",
        lastSyncMessage: "Missing config.url",
      },
    });
    return { ok: false, code: "bad_config", message: "config.url is required for web_url sources" };
  }

  let fetchUrl: URL;
  try {
    fetchUrl = assertHttpUrlAllowed(rawUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid URL";
    await prisma.automationKnowledgeSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "error",
        lastSyncMessage: msg.slice(0, 2000),
      },
    });
    return { ok: false, code: "url_blocked", message: msg };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await secureHttpFetch(fetchUrl.toString(), {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "OpenConduit-KnowledgeSource/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FETCH_BYTES) {
      throw new Error(`Response too large (${buf.length} bytes)`);
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const rawBody = buf.toString("utf8");
    let text: string;
    if (ct.includes("text/html") || ct.includes("application/xhtml")) {
      text = truncateBody(htmlToPlainText(rawBody), 1_000_000);
    } else if (ct.includes("text/plain") || ct.includes("json")) {
      text = truncateBody(rawBody, 1_000_000);
    } else {
      text = truncateBody(htmlToPlainText(rawBody), 1_000_000);
    }
    if (!text.trim()) {
      throw new Error("No text extracted from response");
    }
    const pageTitle =
      ct.includes("text/html") || ct.includes("application/xhtml") ? extractHtmlTitle(rawBody) : null;
    const title = (pageTitle ?? source.name).slice(0, 500);

    let articleId: string | null = null;
    const existing = await prisma.automationKnowledgeArticle.findFirst({
      where: { organizationId: params.organizationId, knowledgeSourceId: source.id },
    });

    const defaultBotIds = Array.isArray(cfg.defaultBotIds)
      ? (cfg.defaultBotIds as unknown[]).filter((x): x is string => typeof x === "string" && zodUuid(x))
      : [];

    const tagsFromCfg = Array.isArray(cfg.tags)
      ? (cfg.tags as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.slice(0, 64))
          .slice(0, 32)
      : undefined;

    if (existing) {
      await prisma.automationKnowledgeArticle.update({
        where: { id: existing.id },
        data: {
          title,
          content: text,
          sourceMimeType: ct.slice(0, 160) || "text/html",
          sourceFileName: fetchUrl.hostname.slice(0, 500),
          ...(typeof cfg.category === "string"
            ? { category: cfg.category.trim() ? cfg.category.trim().slice(0, 120) : null }
            : {}),
          ...(tagsFromCfg !== undefined ? { tags: tagsFromCfg } : {}),
        },
      });
      articleId = existing.id;
    } else {
      const created = await prisma.automationKnowledgeArticle.create({
        data: {
          organizationId: params.organizationId,
          knowledgeSourceId: source.id,
          title,
          content: text,
          category: typeof cfg.category === "string" ? cfg.category.slice(0, 120) : null,
          tags: tagsFromCfg ?? [],
          isActive: true,
          syncToAi: true,
          sourceMimeType: ct.slice(0, 160) || "text/html",
          sourceFileName: fetchUrl.hostname.slice(0, 500),
          botLinks:
            defaultBotIds.length > 0
              ? { create: defaultBotIds.map((botId) => ({ botId })) }
              : undefined,
        },
      });
      articleId = created.id;
    }

    await prisma.automationKnowledgeSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "ok",
        lastSyncMessage: `Fetched ${fetchUrl.hostname}`,
      },
    });

    void reindexKnowledgeArticle(articleId).catch(() => {});

    return { ok: true, articleId, message: "Synced from URL" };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : "fetch failed";
    await prisma.automationKnowledgeSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "error",
        lastSyncMessage: msg.slice(0, 2000),
      },
    });
    return { ok: false, code: "fetch_failed", message: msg.slice(0, 1500) };
  }
}

export function newWebhookToken(): string {
  return randomBytes(32).toString("hex");
}

export async function applyWebhookPush(params: {
  token: string;
  content: string;
  title?: string;
}): Promise<{ ok: true; articleId: string } | { ok: false; code: string; message: string }> {
  const token = params.token.trim().toLowerCase();
  const source = await prisma.automationKnowledgeSource.findFirst({
    where: { webhookToken: token, kind: "webhook_push", isActive: true },
  });
  if (!source) {
    return { ok: false, code: "not_found", message: "Invalid token" };
  }

  const text = truncateBody(params.content.trim(), 1_000_000);
  if (!text) {
    return { ok: false, code: "empty", message: "content required" };
  }

  const title = (params.title?.trim() || source.name).slice(0, 500);
  const cfg = source.config as Record<string, unknown>;
  const defaultBotIds = Array.isArray(cfg.defaultBotIds)
    ? (cfg.defaultBotIds as unknown[]).filter((x): x is string => typeof x === "string" && zodUuid(x))
    : [];

  const existing = await prisma.automationKnowledgeArticle.findFirst({
    where: { organizationId: source.organizationId, knowledgeSourceId: source.id },
  });

  let articleId: string;
  const tagsFromCfg = Array.isArray(cfg.tags)
    ? (cfg.tags as unknown[])
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.slice(0, 64))
        .slice(0, 32)
    : undefined;

  if (existing) {
    await prisma.automationKnowledgeArticle.update({
      where: { id: existing.id },
      data: {
        title,
        content: text,
        sourceMimeType: "application/json",
        sourceFileName: "webhook",
        ...(typeof cfg.category === "string"
          ? { category: cfg.category.trim() ? cfg.category.trim().slice(0, 120) : null }
          : {}),
        ...(tagsFromCfg !== undefined ? { tags: tagsFromCfg } : {}),
      },
    });
    articleId = existing.id;
  } else {
    const tagList = Array.isArray(cfg.tags)
      ? (cfg.tags as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.slice(0, 64))
          .slice(0, 32)
      : [];
    const created = await prisma.automationKnowledgeArticle.create({
      data: {
        organizationId: source.organizationId,
        knowledgeSourceId: source.id,
        title,
        content: text,
        category: typeof cfg.category === "string" ? cfg.category.slice(0, 120) : null,
        tags: tagList,
        isActive: true,
        syncToAi: true,
        sourceMimeType: "application/json",
        sourceFileName: "webhook",
        botLinks:
          defaultBotIds.length > 0 ? { create: defaultBotIds.map((botId) => ({ botId })) } : undefined,
      },
    });
    articleId = created.id;
  }

  await prisma.automationKnowledgeSource.update({
    where: { id: source.id },
    data: {
      lastSyncedAt: new Date(),
      lastSyncStatus: "ok",
      lastSyncMessage: "Webhook push applied",
    },
  });

  void reindexKnowledgeArticle(articleId).catch(() => {});

  return { ok: true, articleId };
}
