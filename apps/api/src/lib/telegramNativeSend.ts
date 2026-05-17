import type { FastifyBaseLogger } from "fastify";

/** Envio nativo via HTTPS para api.telegram.org (sem webhook de saída). */
export async function sendTelegramNativeMessage(options: {
  botToken: string;
  chatId: string;
  text: string;
  log: FastifyBaseLogger;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
}): Promise<string | undefined> {
  const { botToken, chatId, text, log, parseMode } = options;
  if (!botToken.trim() || !chatId.trim()) return undefined;
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number } };
    if (!res.ok || !json.ok) {
      log.warn({ status: res.status, json }, "telegram native sendMessage failed");
      return undefined;
    }
    return json.result?.message_id != null ? String(json.result.message_id) : "sent";
  } catch (err) {
    log.warn({ err }, "telegram native sendMessage error");
    return undefined;
  }
}
