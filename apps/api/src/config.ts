import "dotenv/config";
import { join } from "node:path";
import { JWT_EXPIRY, BCRYPT_COST_FACTOR, publicOriginOnly } from "@openconduit/shared";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

/** Variáveis secretas/URLs: trim, remove aspas e BOM (comum em .env no Windows). */
function optionalSecretEnv(name: string, defaultValue = ""): string {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return raw
    .replace(/^\ufeff/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function optionalIntEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Aceita true/1/yes/on, trim, aspas opcionais e BOM UTF-8 (ficheiros .env no Windows). */
function parseTruthyEnv(name: string): boolean {
  const raw = process.env[name];
  if (raw == null) return false;
  const inner = raw
    .replace(/^\ufeff/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(inner);
}

/** Base URL pública (sem barra final) — usada no webhook exibido em Configurações. */
export function getPublicOrigin(): string {
  return optionalEnv("PUBLIC_URL", "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Origem da aplicação web onde o cliente abre o inquérito CSAT (ex.: https://app.seudominio.com).
 * Ordem: WEB_APP_PUBLIC_URL → PUBLIC_URL → CORS_ORIGIN (dev).
 * Sempre só protocolo+host (sem path) — evita `{PUBLIC_URL}/automation/logo.svg` se a env tiver subpath.
 */
export function getWebAppPublicOrigin(): string {
  const webApp = process.env.WEB_APP_PUBLIC_URL?.trim();
  if (webApp) return publicOriginOnly(webApp);
  const publicUrl = process.env.PUBLIC_URL?.trim();
  if (publicUrl) return publicOriginOnly(publicUrl);
  return publicOriginOnly(optionalEnv("CORS_ORIGIN", "http://localhost:5173"));
}

export function webhookUrlForOrganization(organizationId: string): string {
  return `${getPublicOrigin()}/webhooks/whatsapp/${organizationId}`;
}

/** Webhook Stripe por ferramenta de automação (cobrança via agente — distinto do billing da plataforma). */
export function stripeToolWebhookUrlForOrganization(organizationId: string, toolId: string): string {
  return `${getPublicOrigin()}/webhooks/stripe/org/${encodeURIComponent(organizationId)}/${encodeURIComponent(toolId)}`;
}

/** Webhook dedicado por caixa WhatsApp (um provider por caixa). */
export function webhookUrlForInbox(organizationId: string, inboxId: string): string {
  return `${getPublicOrigin()}/webhooks/whatsapp/${organizationId}/${inboxId}`;
}

/** Webhook Wavoip (Beta) por dispositivo. */
export function wavoipWebhookUrlForDevice(organizationId: string, deviceId: string): string {
  return `${getPublicOrigin()}/webhooks/wavoip/${organizationId}/${deviceId}`;
}

/** Base URL das rotas CRM 3CX (template no painel 3CX). */
export function threeCxCrmBaseUrl(organizationId: string, routePointId: string): string {
  return `${getPublicOrigin()}/integrations/3cx/crm/${organizationId}/${routePointId}`;
}

/** Callback único para todas as organizações quando se usa WhatsApp Embedded (Meta). */
export function metaEmbeddedWebhookUrl(): string {
  return `${getPublicOrigin()}/webhooks/meta/whatsapp`;
}

/** Redirect URI OAuth Google Calendar (registar no Google Cloud Console). */
export function googleCalendarOAuthCallbackUrl(): string {
  return `${getPublicOrigin()}/api/v1/integrations/google-calendar/oauth/callback`;
}

/** URL pública para ingerir mensagens numa caixa (token no path). */
export function channelInboxInboundUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/inbox/${encodeURIComponent(t)}/inbound`;
}

export function channelInboxTelegramUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/inbox/${encodeURIComponent(t)}/telegram`;
}

export function channelInboxTwilioUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/inbox/${encodeURIComponent(t)}/twilio`;
}

/** Base das rotas públicas «nativas» (Client API + webhooks por plataforma), estilo Chatwoot. */
export function channelNativePublicBaseUrl(): string {
  return `${getPublicOrigin()}/api/v1/public/channels`;
}

export function channelNativeClientMessageUrl(ingestToken: string, contactIdentifier: string): string {
  const t = ingestToken.trim();
  const c = encodeURIComponent(contactIdentifier.trim());
  return `${getPublicOrigin()}/api/v1/public/channels/inboxes/${encodeURIComponent(t)}/contacts/${c}/messages`;
}

export function channelNativeFacebookUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/channels/inboxes/${encodeURIComponent(t)}/facebook`;
}

export function channelNativeInstagramUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/channels/inboxes/${encodeURIComponent(t)}/instagram`;
}

export function channelNativeTelegramUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/channels/inboxes/${encodeURIComponent(t)}/telegram`;
}

export function channelNativeLineUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/channels/inboxes/${encodeURIComponent(t)}/line`;
}

export function channelNativeTwilioUrl(ingestToken: string): string {
  const t = ingestToken.trim();
  return `${getPublicOrigin()}/api/v1/public/channels/inboxes/${encodeURIComponent(t)}/twilio`;
}

export const config = {
  port: parseInt(optionalEnv("PORT", "3000"), 10),
  host: optionalEnv("HOST", "0.0.0.0"),
  /** Ficheiros servidos em GET /api/v1/messages/media/:name (WhatsApp descarrega antes de entregar ao utilizador). */
  mediaUploadDir: optionalEnv("MEDIA_UPLOAD_DIR", join(process.cwd(), "uploads", "message-media")),
  /** `local` (disco) ou `minio` (S3-compatível). Super admin pode sobrepor via `platform_settings.media_storage`. */
  mediaStorageDriver: optionalEnv("MEDIA_STORAGE_DRIVER", "local"),
  minioEndpoint: optionalEnv("MINIO_ENDPOINT", ""),
  minioAccessKey: optionalEnv("MINIO_ACCESS_KEY", ""),
  minioSecretKey: optionalEnv("MINIO_SECRET_KEY", ""),
  minioBucket: optionalEnv("MINIO_BUCKET", "openconduit-media"),
  minioRegion: optionalEnv("MINIO_REGION", "us-east-1"),
  minioUseSsl: parseTruthyEnv("MINIO_USE_SSL"),
  /** Opcional: URL pública do bucket (senão usa proxy API). */
  minioPublicBaseUrl: optionalEnv("MINIO_PUBLIC_BASE_URL", ""),
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtExpiry: JWT_EXPIRY,
  bcryptCostFactor: BCRYPT_COST_FACTOR,
  publicUrl: getPublicOrigin(),
  redisUrl: optionalEnv("REDIS_URL", "redis://localhost:6379"),
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  isProduction: optionalEnv("NODE_ENV", "development") === "production",
  corsOrigin: optionalEnv("CORS_ORIGIN", "http://localhost:5173"),
  /**
   * Chave opcional no servidor para pré-visualização de prompts (API OpenAI-compatível).
   * Ordem: OPENAI_PROMPT_PREVIEW_KEY, depois OPENAI_API_KEY. O cliente pode omitir apiKey no POST preview quando definida.
   */
  openAiPromptPreviewKey: optionalEnv(
    "OPENAI_PROMPT_PREVIEW_KEY",
    optionalEnv("OPENAI_API_KEY", ""),
  ).trim(),
  /** Base URL OpenAI (embeddings + chat compat). Sem barra final. */
  openAiApiBaseUrl: optionalEnv("OPENAI_API_BASE_URL", "https://api.openai.com/v1")
    .trim()
    .replace(/\/+$/, ""),
  /** Provedor LLM usado quando organization.ai_billing_mode = PLATFORM_CREDITS. */
  platformCreditsLlmProvider: optionalEnv("PLATFORM_CREDITS_LLM_PROVIDER", "openai").trim(),
  /** Taxa USD→BRL para conciliação de custos de IA (Super Admin). */
  platformCreditsUsdBrlRate: optionalEnv("PLATFORM_CREDITS_USD_BRL_RATE", "5.45").trim(),
  /** Chave administrativa OpenAI (Costs/Usage API). Nunca expor ao frontend. */
  openAiAdminKey: optionalEnv("OPENAI_ADMIN_KEY", "").trim(),
  /** Modelo de embeddings para indexação semântica da KB (requer chave OpenAI no servidor). */
  openAiEmbeddingModel: optionalEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small").trim(),
  /** Modelo OpenAI para `POST /v1/audio/transcriptions` (ex.: whisper-1, gpt-4o-mini-transcribe). */
  openAiWhisperModel: optionalEnv("OPENAI_WHISPER_MODEL", "whisper-1").trim(),
  /** Modelo OpenAI Vision para transcrição/OCR de imagens inbound. */
  openAiVisionModel: optionalEnv("OPENAI_VISION_MODEL", "gpt-4o-mini").trim(),
  /** Chave opcional para pré-visualização com Google Gemini (cliente pode omitir apiKey quando definida). */
  geminiPromptPreviewKey: optionalEnv("GEMINI_PROMPT_PREVIEW_KEY", "").trim(),
  /**
   * Chave opcional Kimi / Moonshot (OpenAI-compatible). Ordem: KIMI_PROMPT_PREVIEW_KEY, MOONSHOT_API_KEY.
   */
  kimiPromptPreviewKey: optionalEnv(
    "KIMI_PROMPT_PREVIEW_KEY",
    optionalEnv("MOONSHOT_API_KEY", ""),
  ).trim(),
  /** Base URL Kimi Open Platform (Chat Completions compatível). */
  kimiApiBaseUrl: optionalEnv("KIMI_API_BASE_URL", "https://api.moonshot.ai/v1")
    .trim()
    .replace(/\/+$/, ""),
  /**
   * Chave opcional xAI Grok (OpenAI-compatible). Ordem: XAI_PROMPT_PREVIEW_KEY, XAI_API_KEY.
   */
  xaiPromptPreviewKey: optionalEnv(
    "XAI_PROMPT_PREVIEW_KEY",
    optionalEnv("XAI_API_KEY", ""),
  ).trim(),
  /** Base URL xAI (Chat Completions compatível). */
  xaiApiBaseUrl: optionalEnv("XAI_API_BASE_URL", "https://api.x.ai/v1")
    .trim()
    .replace(/\/+$/, ""),
  /**
   * Chave opcional Anthropic Claude (Messages API). Ordem: ANTHROPIC_PROMPT_PREVIEW_KEY, ANTHROPIC_API_KEY.
   */
  anthropicPromptPreviewKey: optionalEnv(
    "ANTHROPIC_PROMPT_PREVIEW_KEY",
    optionalEnv("ANTHROPIC_API_KEY", ""),
  ).trim(),
  /** Base URL Anthropic (Messages API). */
  anthropicApiBaseUrl: optionalEnv("ANTHROPIC_API_BASE_URL", "https://api.anthropic.com")
    .trim()
    .replace(/\/+$/, ""),
  /**
   * Máximo de pedidos LLM em voo por API key (contactos partilham a mesma chave).
   * Evita stampede TPM/RPM quando vários WhatsApps disparam o agente em paralelo.
   */
  nativeLlmMaxConcurrent: optionalIntEnv("NATIVE_LLM_MAX_CONCURRENT", 2, 1, 32),
  /** Tempo máximo na fila do gate LLM antes de falhar (ms). */
  nativeLlmMaxQueueWaitMs: optionalIntEnv("NATIVE_LLM_MAX_QUEUE_WAIT_MS", 90_000, 5_000, 300_000),
  /** Logs estruturados (`agent_kb_debug`) na pesquisa de conhecimento do agente nativo. */
  agentKbDebug: parseTruthyEnv("AGENT_KB_DEBUG"),
  /** Mem0 Platform — memória semântica externa (Agent Engine). */
  mem0ApiKey: optionalEnv("MEM0_API_KEY", "").trim(),
  mem0ApiBaseUrl: optionalEnv("MEM0_API_BASE_URL", "https://api.mem0.ai")
    .trim()
    .replace(/\/+$/, ""),
  /** API Nvoip v2 — https://nvoip.docs.apiary.io/ */
  nvoipApiBaseUrl: optionalEnv("NVOIP_API_BASE_URL", "https://api.nvoip.com.br/v2").replace(/\/+$/, ""),
  /** Basic auth para POST /oauth/token (credencial pública da documentação Nvoip). */
  /** Alerta de saldo baixo (R$) ao atualizar saldo Nvoip; pode ser sobreposto por conta (externalConfig). */
  nvoipDefaultBalanceAlertBrl: Number(optionalEnv("NVOIP_BALANCE_ALERT_BRL", "5")) || 5,
  nvoipOAuthBasic: optionalEnv(
    "NVOIP_OAUTH_BASIC",
    "TnZvaXBBcGlWMjpUblp2YVhCQmNHbFdNakl3TWpFPQ==",
  ).trim(),
  /** Servidor SIP Nvoip para softphone embutido (WSS). */
  /** Domínio SIP (URI/registrar) — padrão Nvoip para ramais secundários / webphone. */
  nvoipSipDomain: optionalEnv("NVOIP_SIP_DOMAIN", optionalEnv("NVOIP_SIP_SERVER", "app.nvoip.com.br")).trim(),
  /** URL WSS completa (ex.: wss://app.nvoip.com.br:6443). Se vazio, monta a partir do domínio + porta. */
  nvoipSipWssUrl: optionalEnv("NVOIP_SIP_WSS_URL", "").trim(),
  nvoipSipWssPort: optionalEnv("NVOIP_SIP_WSS_PORT", "6443").trim(),
  /** @deprecated use NVOIP_SIP_DOMAIN — mantido por compatibilidade. */
  nvoipSipServer: optionalEnv("NVOIP_SIP_SERVER", optionalEnv("NVOIP_SIP_DOMAIN", "app.nvoip.com.br")).trim(),
  /** Stripe — billing SaaS (secret key só no servidor). */
  stripeSecretKey: optionalSecretEnv("STRIPE_SECRET_KEY"),
  stripePublishableKey: optionalSecretEnv("STRIPE_PUBLISHABLE_KEY"),
  stripeWebhookSecret: optionalSecretEnv("STRIPE_WEBHOOK_SECRET"),
  stripeApiVersion: optionalEnv("STRIPE_API_VERSION", "2025-02-24.acacia").trim(),
  stripeCheckoutSuccessUrl: optionalEnv(
    "STRIPE_CHECKOUT_SUCCESS_URL",
    `${getWebAppPublicOrigin()}/settings?section=billing&checkout=success`,
  ).trim(),
  stripeCheckoutCancelUrl: optionalEnv(
    "STRIPE_CHECKOUT_CANCEL_URL",
    `${getWebAppPublicOrigin()}/settings?section=billing&checkout=cancel`,
  ).trim(),
  /** Mercado Pago — billing SaaS (access token só no servidor). */
  mercadopagoAccessToken: optionalSecretEnv("MERCADOPAGO_ACCESS_TOKEN"),
  mercadopagoPublicKey: optionalSecretEnv("MERCADOPAGO_PUBLIC_KEY"),
  mercadopagoSandboxAccessToken: optionalSecretEnv("MERCADOPAGO_SANDBOX_ACCESS_TOKEN"),
  mercadopagoSandboxPublicKey: optionalSecretEnv("MERCADOPAGO_SANDBOX_PUBLIC_KEY"),
  mercadopagoProductionAccessToken: optionalSecretEnv("MERCADOPAGO_PRODUCTION_ACCESS_TOKEN"),
  mercadopagoProductionPublicKey: optionalSecretEnv("MERCADOPAGO_PRODUCTION_PUBLIC_KEY"),
  mercadopagoWebhookSecret: optionalSecretEnv("MERCADOPAGO_WEBHOOK_SECRET"),
  mercadopagoClientId: optionalSecretEnv("MERCADOPAGO_CLIENT_ID"),
  mercadopagoClientSecret: optionalSecretEnv("MERCADOPAGO_CLIENT_SECRET"),
  mercadopagoOAuthRedirectUri: optionalEnv("MERCADOPAGO_OAUTH_REDIRECT_URI", "").trim(),
  mercadopagoCheckoutSuccessUrl: optionalEnv(
    "MERCADOPAGO_CHECKOUT_SUCCESS_URL",
    `${getWebAppPublicOrigin()}/settings?section=billing&checkout=success`,
  ).trim(),
  mercadopagoCheckoutCancelUrl: optionalEnv(
    "MERCADOPAGO_CHECKOUT_CANCEL_URL",
    `${getWebAppPublicOrigin()}/settings?section=billing&checkout=cancel`,
  ).trim(),
} as const;

/** Stripe configurado para checkout/webhooks (não exige publishable key no backend). */
export function isStripeBillingConfigured(): boolean {
  return Boolean(config.stripeSecretKey && config.stripeWebhookSecret);
}

/** Mercado Pago configurado na plataforma (Fase 0 — credenciais globais). */
export function isMercadoPagoBillingConfigured(): boolean {
  return Boolean(
    config.mercadopagoAccessToken ||
      config.mercadopagoSandboxAccessToken ||
      config.mercadopagoProductionAccessToken,
  );
}

/** Mercado Pago pronto para receber webhooks (token + secret para validar assinatura). */
export function isMercadoPagoWebhookConfigured(): boolean {
  return Boolean(
    (config.mercadopagoAccessToken ||
      config.mercadopagoSandboxAccessToken ||
      config.mercadopagoProductionAccessToken) &&
      config.mercadopagoWebhookSecret,
  );
}
