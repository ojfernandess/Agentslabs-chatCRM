import { createHash } from "node:crypto";
import type { ChannelNativeConfig, PreChatFormField, WebsiteWidgetConfig } from "./channelNativeTypes.js";
import {
  defaultWebsiteBusinessHoursDays,
  websiteBusinessHoursFromChannelConfig,
  type WebsiteBusinessHoursDay,
} from "./websiteBusinessHours.js";

/** Incrementar quando o JS público do widget mudar estruturalmente (cache bust global). */
export const WIDGET_SDK_VERSION = "6";

export const DEFAULT_PRE_CHAT_FIELDS: PreChatFormField[] = [
  {
    key: "emailAddress",
    type: "email",
    label: "E-mail",
    placeholder: "Endereço de e-mail",
    required: true,
    enabled: true,
  },
  {
    key: "fullName",
    type: "text",
    label: "Nome",
    placeholder: "Seu nome",
    required: true,
    enabled: true,
  },
  {
    key: "phoneNumber",
    type: "tel",
    label: "Telefone",
    placeholder: "11 - 99999-9999",
    required: false,
    enabled: true,
  },
];

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function parsePreChatFields(raw: unknown): PreChatFormField[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const fields: PreChatFormField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const key = str(o.key);
    if (!key) continue;
    const typeRaw = str(o.type);
    const type = typeRaw === "email" || typeRaw === "tel" ? typeRaw : "text";
    fields.push({
      key,
      type,
      label: str(o.label) ?? key,
      placeholder: str(o.placeholder) ?? "",
      required: o.required === true,
      enabled: o.enabled !== false,
    });
  }
  return fields.length ? fields : undefined;
}

function parseBusinessHoursDays(raw: unknown): WebsiteBusinessHoursDay[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const days: WebsiteBusinessHoursDay[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const day = typeof o.day === "number" ? o.day : null;
    if (day == null || day < 1 || day > 7) continue;
    days.push({
      day,
      enabled: o.enabled === true,
      allDay: o.allDay === true,
      start: typeof o.start === "string" ? o.start : undefined,
      end: typeof o.end === "string" ? o.end : undefined,
    });
  }
  return days.length ? days : undefined;
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
    preChatFormEnabled: o.preChatFormEnabled === true,
    preChatFormMessage: str(o.preChatFormMessage),
    preChatFormFields: parsePreChatFields(o.preChatFormFields),
    businessHoursEnabled: o.businessHoursEnabled === true,
    businessHoursTimezone: str(o.businessHoursTimezone),
    businessHoursUnavailableMessage: str(o.businessHoursUnavailableMessage),
    businessHoursDays: parseBusinessHoursDays(o.businessHoursDays),
  };
}

export function widgetConfigRevision(channelConfig: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(channelConfig ?? {}))
    .digest("hex")
    .slice(0, 12);
}

export function publicWebsiteWidgetSettings(
  inboxName: string,
  channelConfig: unknown,
): WebsiteWidgetConfig & { inboxName: string; revision: string; sdkVersion: string } {
  const cfg = parseWebsiteWidgetConfig(channelConfig);
  const businessHours = websiteBusinessHoursFromChannelConfig(channelConfig);
  return {
    inboxName,
    revision: widgetConfigRevision(channelConfig),
    sdkVersion: WIDGET_SDK_VERSION,
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
    preChatFormEnabled: cfg.preChatFormEnabled === true,
    preChatFormMessage:
      cfg.preChatFormMessage ?? "Preencha as informações abaixo, para iniciar seu atendimento.",
    preChatFormFields: cfg.preChatFormFields ?? DEFAULT_PRE_CHAT_FIELDS,
    businessHoursEnabled: businessHours.enabled,
    businessHoursTimezone: businessHours.timezone,
    businessHoursUnavailableMessage:
      businessHours.unavailableMessage ??
      "No momento estamos fora do horário de atendimento. Deixe sua mensagem que retornaremos em breve.",
    businessHoursDays: businessHours.days.length ? businessHours.days : defaultWebsiteBusinessHoursDays(),
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
