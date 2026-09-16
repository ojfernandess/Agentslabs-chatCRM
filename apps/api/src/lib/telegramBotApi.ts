import type { FastifyBaseLogger } from "fastify";
import {
  isValidTelegramBotToken,
  MASKED_TELEGRAM_BOT_TOKEN,
  parseInboxTelegramFromChannelConfig,
} from "./inboxTelegramConfig.js";

type TelegramApiEnvelope<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export type TelegramWebhookInfo = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
};

export type TelegramSetWebhookResult =
  | { ok: true; description?: string }
  | { ok: false; error: string; errorCode?: number };

export type TelegramWebhookStatus = {
  ok: boolean;
  expectedUrl: string;
  telegramUrl: string | null;
  matches: boolean;
  pendingUpdateCount: number;
  lastErrorMessage: string | null;
  error?: string;
};

async function callTelegramBotMethod<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown> | undefined,
  log: FastifyBaseLogger,
): Promise<{ ok: boolean; result?: T; error?: string; errorCode?: number }> {
  const token = botToken.trim();
  if (!token) return { ok: false, error: "Bot token is required" };

  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as TelegramApiEnvelope<T>;
    if (!res.ok || !json.ok) {
      const error = json.description ?? `Telegram API HTTP ${res.status}`;
      log.warn({ method, status: res.status, json }, "telegram bot api call failed");
      return { ok: false, error, errorCode: json.error_code };
    }
    return { ok: true, result: json.result };
  } catch (err) {
    log.warn({ err, method }, "telegram bot api call error");
    return { ok: false, error: err instanceof Error ? err.message : "Telegram API request failed" };
  }
}

export function resolveTelegramBotTokenForInbox(
  storedConfig: unknown,
  draftConfig?: unknown,
): string | null {
  if (draftConfig != null && typeof draftConfig === "object") {
    const draft = parseInboxTelegramFromChannelConfig(draftConfig).telegramBotToken;
    if (draft && draft !== MASKED_TELEGRAM_BOT_TOKEN && isValidTelegramBotToken(draft)) {
      return draft;
    }
  }
  const stored = parseInboxTelegramFromChannelConfig(storedConfig).telegramBotToken;
  if (!stored || !isValidTelegramBotToken(stored)) return null;
  return stored;
}

export function assertTelegramWebhookUrl(webhookUrl: string): string | null {
  const url = webhookUrl.trim();
  if (!url) return "Webhook URL is missing";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return "Telegram requires a public HTTPS webhook URL";
    }
  } catch {
    return "Invalid webhook URL";
  }
  return null;
}

/** Regista a webhook nativa do OpenConduit no Telegram (setWebhook). */
export async function registerTelegramInboxWebhook(params: {
  botToken: string;
  webhookUrl: string;
  log: FastifyBaseLogger;
  dropPendingUpdates?: boolean;
}): Promise<TelegramSetWebhookResult> {
  const urlError = assertTelegramWebhookUrl(params.webhookUrl);
  if (urlError) return { ok: false, error: urlError };

  const r = await callTelegramBotMethod<boolean>(
    params.botToken,
    "setWebhook",
    {
      url: params.webhookUrl.trim(),
      drop_pending_updates: params.dropPendingUpdates === true,
      allowed_updates: ["message", "edited_message"],
    },
    params.log,
  );
  if (!r.ok) return { ok: false, error: r.error ?? "setWebhook failed", errorCode: r.errorCode };
  return { ok: true, description: "Webhook registered" };
}

export async function fetchTelegramWebhookStatus(params: {
  botToken: string;
  expectedUrl: string;
  log: FastifyBaseLogger;
}): Promise<TelegramWebhookStatus> {
  const expectedUrl = params.expectedUrl.trim();
  const r = await callTelegramBotMethod<TelegramWebhookInfo>(
    params.botToken,
    "getWebhookInfo",
    undefined,
    params.log,
  );
  if (!r.ok || !r.result) {
    return {
      ok: false,
      expectedUrl,
      telegramUrl: null,
      matches: false,
      pendingUpdateCount: 0,
      lastErrorMessage: null,
      error: r.error ?? "getWebhookInfo failed",
    };
  }
  const telegramUrl = r.result.url?.trim() || null;
  return {
    ok: true,
    expectedUrl,
    telegramUrl,
    matches: Boolean(telegramUrl && telegramUrl === expectedUrl),
    pendingUpdateCount: r.result.pending_update_count ?? 0,
    lastErrorMessage: r.result.last_error_message ?? null,
  };
}
