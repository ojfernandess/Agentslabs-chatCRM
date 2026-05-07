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

export const config = {
  port: parseInt(optionalEnv("PORT", "3000"), 10),
  host: optionalEnv("HOST", "0.0.0.0"),
  /** Ficheiros servidos em GET /api/v1/messages/media/:name (WhatsApp descarrega antes de entregar ao utilizador). */
  mediaUploadDir: optionalEnv("MEDIA_UPLOAD_DIR", join(process.cwd(), "uploads", "message-media")),
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtExpiry: JWT_EXPIRY,
  bcryptCostFactor: BCRYPT_COST_FACTOR,
  publicUrl: getPublicOrigin(),
  redisUrl: optionalEnv("REDIS_URL", "redis://localhost:6379"),
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  isProduction: optionalEnv("NODE_ENV", "development") === "production",
  corsOrigin: optionalEnv("CORS_ORIGIN", "http://localhost:5173"),
} as const;
