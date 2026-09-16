export const MASKED_TELEGRAM_BOT_TOKEN = "••••••••";

function asRecord(cfg: unknown): Record<string, unknown> | null {
  return cfg !== null && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function isValidTelegramBotToken(token: string): boolean {
  const t = token.trim();
  const i = t.indexOf(":");
  if (i <= 0 || i >= t.length - 1) return false;
  const idPart = t.slice(0, i);
  const secretPart = t.slice(i + 1);
  return /^\d+$/.test(idPart) && /^[A-Za-z0-9_-]+$/.test(secretPart);
}

export function parseInboxTelegramFromChannelConfig(cfg: unknown): { telegramBotToken?: string } {
  const c = asRecord(cfg);
  if (!c) return {};
  return { telegramBotToken: str(c.telegramBotToken) };
}

export function maskTelegramChannelConfigForClient(cfg: unknown): unknown {
  const c = asRecord(cfg);
  if (!c || !str(c.telegramBotToken)) return cfg;
  return { ...c, telegramBotToken: MASKED_TELEGRAM_BOT_TOKEN };
}

export function normalizeTelegramInboxChannelConfig(
  existing: unknown,
  patch: unknown,
): Record<string, unknown> {
  const base = asRecord(existing) ?? {};
  const p = asRecord(patch) ?? {};
  const out: Record<string, unknown> = { ...base, ...p };
  const token = str(p.telegramBotToken);
  if (token && token !== MASKED_TELEGRAM_BOT_TOKEN) {
    if (!isValidTelegramBotToken(token)) {
      throw new Error("Invalid Telegram bot token format");
    }
    out.telegramBotToken = token;
  } else if (token === MASKED_TELEGRAM_BOT_TOKEN) {
    delete out.telegramBotToken;
    if (base.telegramBotToken) out.telegramBotToken = base.telegramBotToken;
  }
  return out;
}
