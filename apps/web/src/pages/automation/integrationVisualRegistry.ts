import type { ToolPresetMeta } from "./automationToolTypes";
import { paymentToolLogoUrl } from "./paymentToolBranding";

export type IntegrationVisual = {
  displayName: string;
  provider: string | null;
  logoUrl: string | null;
  /** Lucide icon name when no logo is available */
  icon: string;
  logoAlt: string;
  /** Stripe wordmark needs wider container */
  wideLogo?: boolean;
};

type RegistryEntry = {
  displayName?: string;
  provider?: string;
  logoUrl?: string;
  icon?: string;
  wideLogo?: boolean;
};

const LOGO = (file: string) => `/integrations/${file}`;

/** Presentation-only mapping keyed by presetKey. Does not alter integration IDs. */
const PRESET_VISUALS: Record<string, RegistryEntry> = {
  mcp_list_teams: { displayName: "Listar equipes", provider: "OpenNexo", icon: "Users" },
  mcp_list_pipeline_stages: { displayName: "Listar etapas do funil", provider: "OpenNexo", icon: "Kanban" },
  mcp_assign_conversation_team: { displayName: "Atribuir equipe à conversa", provider: "OpenNexo", icon: "UserPlus" },
  mcp_set_conversation_status: { displayName: "Definir status da conversa", provider: "OpenNexo", icon: "ToggleLeft" },
  mcp_knowledge_search: { displayName: "Buscar conhecimento", provider: "OpenNexo", icon: "BookOpen" },
  google_calendar_oauth: {
    displayName: "Google Calendar",
    provider: "Google",
    logoUrl: LOGO("googlecalendar.svg"),
  },
  cal_com_api: { displayName: "Cal.com", provider: "Cal.com", logoUrl: LOGO("caldotcom.svg") },
  mcp_consultar_agendas: { displayName: "Consultar agendas", provider: "Google", logoUrl: LOGO("googlecalendar.svg") },
  mcp_scheduling_outlook: {
    displayName: "Microsoft Outlook",
    provider: "Microsoft",
    logoUrl: LOGO("microsoftoutlook.svg"),
  },
  mcp_call_human: { displayName: "Transferir para humano", provider: "OpenNexo", icon: "Headset" },
  mcp_end_conversation: { displayName: "Encerrar conversa", provider: "OpenNexo", icon: "PhoneOff" },
  mcp_ping: { displayName: "Ping / health check", provider: "OpenNexo", icon: "Activity" },
  elevenlabs_tts: { displayName: "ElevenLabs TTS", provider: "ElevenLabs", logoUrl: LOGO("elevenlabs.svg") },
  email_resend: { displayName: "Resend", provider: "Resend", logoUrl: LOGO("resend.svg") },
  email_gmail: { displayName: "Gmail", provider: "Google", logoUrl: LOGO("gmail.svg") },
  email_sendgrid: { displayName: "SendGrid", provider: "SendGrid", logoUrl: LOGO("sendgrid.svg") },
  email_mailgun: { displayName: "Mailgun", provider: "Mailgun", logoUrl: LOGO("mailgun.svg") },
  email_smtp: { displayName: "SMTP", provider: "E-mail", icon: "Server" },
  http_api_builder: { displayName: "HTTP / API Builder", provider: "OpenNexo", icon: "Globe" },
  http_api_custom: { displayName: "HTTP API Customizada", provider: "OpenNexo", icon: "Radio" },
  webhook_callback: { displayName: "Webhook (saída)", provider: "OpenNexo", icon: "Webhook" },
  int_twilio: { displayName: "Twilio", provider: "Twilio", logoUrl: LOGO("twilio.svg") },
  int_evolution_api: { displayName: "Evolution API", provider: "Evolution API", icon: "Smartphone" },
  int_chatwoot: { displayName: "Chatwoot", provider: "Chatwoot", logoUrl: LOGO("chatwoot.svg") },
  int_stripe: { displayName: "Stripe", provider: "Stripe", wideLogo: true },
  int_mercadopago: { displayName: "Mercado Pago", provider: "Mercado Pago", logoUrl: "/logo-mercadopago.svg" },
  int_google_sheets: { displayName: "Google Sheets", provider: "Google", logoUrl: LOGO("googlesheets.svg") },
  int_slack: { displayName: "Slack", provider: "Slack", logoUrl: LOGO("slack.svg") },
  int_discord: { displayName: "Discord", provider: "Discord", logoUrl: LOGO("discord.svg") },
  int_openai_api: { displayName: "OpenAI API", provider: "OpenAI", logoUrl: LOGO("openai.svg") },
  int_anthropic_api: { displayName: "Anthropic", provider: "Anthropic", logoUrl: LOGO("anthropic.svg") },
  int_groq_api: { displayName: "Groq", provider: "Groq", logoUrl: LOGO("groq.svg") },
  int_postgres: { displayName: "PostgreSQL", provider: "PostgreSQL", logoUrl: LOGO("postgresql.svg") },
  int_mysql: { displayName: "MySQL", provider: "MySQL", logoUrl: LOGO("mysql.svg") },
  int_redis: { displayName: "Redis", provider: "Redis", logoUrl: LOGO("redis.svg") },
};

export function resolveIntegrationVisual(input: {
  presetKey: string;
  name: string;
  marketplace?: ToolPresetMeta["marketplace"];
  toolType?: string;
}): IntegrationVisual {
  const mapped = PRESET_VISUALS[input.presetKey];
  const paymentLogo = paymentToolLogoUrl(input.presetKey, undefined);
  const logoUrl =
    mapped?.logoUrl ??
    paymentLogo ??
    input.marketplace?.logoUrl ??
    null;
  const icon = mapped?.icon ?? input.marketplace?.icon ?? "Plug";
  const displayName = mapped?.displayName ?? input.name;
  const provider = mapped?.provider ?? null;

  return {
    displayName,
    provider,
    logoUrl,
    icon,
    logoAlt: provider ? `${provider} logo` : `${displayName} logo`,
    wideLogo: mapped?.wideLogo ?? logoUrl?.includes("Stripe") ?? false,
  };
}

/** Decorative hero logos (subset of high-recognition integrations). */
export const HERO_DECOR_LOGOS: Array<{ logoUrl: string; alt: string }> = [
  { logoUrl: LOGO("openai.svg"), alt: "OpenAI" },
  { logoUrl: LOGO("anthropic.svg"), alt: "Anthropic" },
  { logoUrl: LOGO("gmail.svg"), alt: "Gmail" },
  { logoUrl: LOGO("slack.svg"), alt: "Slack" },
  { logoUrl: LOGO("whatsapp.svg"), alt: "WhatsApp" },
];

export function resolveInstalledToolVisual(tool: {
  name: string;
  toolType: string;
  config?: unknown;
}): IntegrationVisual {
  const cfg = tool.config && typeof tool.config === "object" ? (tool.config as Record<string, unknown>) : {};
  const presetKey = typeof cfg.presetKey === "string" ? cfg.presetKey : "";
  if (presetKey) {
    return resolveIntegrationVisual({
      presetKey,
      name: tool.name,
      toolType: tool.toolType,
    });
  }
  const ui = cfg.ui && typeof cfg.ui === "object" ? (cfg.ui as Record<string, unknown>) : {};
  const icon = typeof ui.icon === "string" ? ui.icon : "Plug";
  return {
    displayName: tool.name,
    provider: null,
    logoUrl: paymentToolLogoUrl(undefined, typeof cfg.provider === "string" ? cfg.provider : undefined),
    icon,
    logoAlt: tool.name,
    wideLogo: false,
  };
}
