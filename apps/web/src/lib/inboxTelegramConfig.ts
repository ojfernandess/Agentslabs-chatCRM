export const MASKED_TELEGRAM_BOT_TOKEN = "••••••••";

export type InboxTelegramConfigFields = {
  telegramBotToken?: string;
};

function asRecord(cfg: unknown): Record<string, unknown> | null {
  return cfg !== null && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Formato típico do BotFather: `{bot_id}:{secret}` */
export function isValidTelegramBotToken(token: string): boolean {
  const t = token.trim();
  const i = t.indexOf(":");
  if (i <= 0 || i >= t.length - 1) return false;
  const idPart = t.slice(0, i);
  const secretPart = t.slice(i + 1);
  return /^\d+$/.test(idPart) && /^[A-Za-z0-9_-]+$/.test(secretPart);
}

export function parseInboxTelegramFromChannelConfig(cfg: unknown): InboxTelegramConfigFields {
  const c = asRecord(cfg);
  if (!c) return {};
  return { telegramBotToken: str(c.telegramBotToken) };
}

export function isInboxTelegramConfigured(fields: InboxTelegramConfigFields): boolean {
  const token = fields.telegramBotToken;
  if (!token || token === MASKED_TELEGRAM_BOT_TOKEN) return false;
  return isValidTelegramBotToken(token);
}

export function maskTelegramChannelConfigForClient(cfg: unknown): unknown {
  const c = asRecord(cfg);
  if (!c || !str(c.telegramBotToken)) return cfg;
  return { ...c, telegramBotToken: MASKED_TELEGRAM_BOT_TOKEN };
}

export function buildInboxTelegramChannelConfig(
  existing: unknown,
  patch: { telegramBotToken?: string },
): Record<string, unknown> {
  const base = asRecord(existing) ?? {};
  const out: Record<string, unknown> = { ...base };
  const token = patch.telegramBotToken?.trim();
  if (token && token !== MASKED_TELEGRAM_BOT_TOKEN) {
    out.telegramBotToken = token;
  }
  return out;
}

export function buildSetWebhookCurl(botToken: string, webhookUrl: string): string {
  const payload = JSON.stringify({ url: webhookUrl });
  return `curl -X POST "https://api.telegram.org/bot${botToken.trim()}/setWebhook" -H "Content-Type: application/json" -d '${payload}'`;
}
