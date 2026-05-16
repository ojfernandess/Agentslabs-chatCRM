import type { ChannelNativeConfig, WebsiteWidgetConfig } from "./channelNativeTypes.js";

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

export function parseWebsiteWidgetConfig(raw: unknown): WebsiteWidgetConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const pos = str(o.widgetPosition);
  const bubble = str(o.bubbleType);
  return {
    websiteUrl: str(o.websiteUrl),
    widgetColor: str(o.widgetColor),
    siteName: str(o.siteName),
    welcomeTitle: str(o.welcomeTitle),
    welcomeMessage: str(o.welcomeMessage),
    welcomeTagline: str(o.welcomeTagline),
    avatarUrl: str(o.avatarUrl),
    widgetPosition: pos === "left" ? "left" : pos === "right" ? "right" : undefined,
    bubbleType: bubble === "expanded" ? "expanded" : bubble === "standard" ? "standard" : undefined,
    bubbleLauncherTitle: str(o.bubbleLauncherTitle),
    greetingEnabled: o.greetingEnabled === true,
    responseTimeLabel: str(o.responseTimeLabel),
  };
}

export function publicWebsiteWidgetSettings(
  inboxName: string,
  channelConfig: unknown,
): WebsiteWidgetConfig & { inboxName: string } {
  const cfg = parseWebsiteWidgetConfig(channelConfig);
  return {
    inboxName,
    siteName: cfg.siteName ?? inboxName,
    widgetColor: cfg.widgetColor ?? "#2563eb",
    welcomeTitle: cfg.welcomeTitle ?? "Olá!",
    welcomeMessage:
      cfg.welcomeMessage ??
      "Nós tornamos simples a conexão conosco. Pergunte qualquer assunto ou compartilhe seus comentários.",
    welcomeTagline: cfg.welcomeTagline ?? cfg.responseTimeLabel ?? "Respondemos em alguns minutos",
    responseTimeLabel: cfg.responseTimeLabel ?? "Respondemos em alguns minutos",
    websiteUrl: cfg.websiteUrl,
    avatarUrl: cfg.avatarUrl,
    widgetPosition: cfg.widgetPosition ?? "right",
    bubbleType: cfg.bubbleType ?? "standard",
    bubbleLauncherTitle: cfg.bubbleLauncherTitle ?? "Fale conosco no chat",
    greetingEnabled: cfg.greetingEnabled === true,
  };
}

export function mergeWebsiteWidgetIntoChannelConfig(
  prev: unknown,
  patch: WebsiteWidgetConfig,
): ChannelNativeConfig {
  const base =
    prev && typeof prev === "object" && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") {
      delete base[k];
    } else {
      base[k] = v;
    }
  }
  return base as ChannelNativeConfig;
}
