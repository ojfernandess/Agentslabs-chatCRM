import "dotenv/config";
import { join } from "node:path";
import { JWT_EXPIRY, BCRYPT_COST_FACTOR } from "@openconduit/shared";

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
 * Em desenvolvimento costuma coincidir com CORS_ORIGIN (Vite). Em produção, defina explicitamente se o painel está noutro host que PUBLIC_URL.
 */
export function getWebAppPublicOrigin(): string {
  return optionalEnv("WEB_APP_PUBLIC_URL", optionalEnv("CORS_ORIGIN", getPublicOrigin())).replace(/\/+$/, "");
}

export function webhookUrlForOrganization(organizationId: string): string {
  return `${getPublicOrigin()}/webhooks/whatsapp/${organizationId}`;
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
  /** Modelo de embeddings para indexação semântica da KB (requer chave OpenAI no servidor). */
  openAiEmbeddingModel: optionalEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small").trim(),
  /** Modelo OpenAI para `POST /v1/audio/transcriptions` (ex.: whisper-1, gpt-4o-mini-transcribe). */
  openAiWhisperModel: optionalEnv("OPENAI_WHISPER_MODEL", "whisper-1").trim(),
  /** Chave opcional para pré-visualização com Google Gemini (cliente pode omitir apiKey quando definida). */
  geminiPromptPreviewKey: optionalEnv("GEMINI_PROMPT_PREVIEW_KEY", "").trim(),
  /** Logs estruturados (`agent_kb_debug`) na pesquisa de conhecimento do agente nativo. */
  agentKbDebug: parseTruthyEnv("AGENT_KB_DEBUG"),
} as const;
