import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { BillingError } from "./StripeCustomerService.js";

export const MERCADOPAGO_BILLING_PLATFORM_KEY = "mercadopago_billing";

export type MercadoPagoBillingMode = "sandbox" | "production";
export type MercadoPagoTokenMode = MercadoPagoBillingMode | "unknown";

export type MercadoPagoBillingPlatformSettings = {
  mode: MercadoPagoBillingMode;
};

export type MercadoPagoBillingModeDiagnostics = {
  mode: MercadoPagoBillingMode;
  activeAccessTokenConfigured: boolean;
  activePublicKeyConfigured: boolean;
  tokenMode: MercadoPagoTokenMode;
  tokenModeMismatch: boolean;
  activeAccessTokenPreview: string | null;
  activePublicKeyPreview: string | null;
};

const DEFAULT_SETTINGS: MercadoPagoBillingPlatformSettings = {
  mode: "sandbox",
};

export function inferMercadoPagoTokenMode(accessToken: string): MercadoPagoTokenMode {
  const token = accessToken.trim();
  if (token.startsWith("TEST-")) return "sandbox";
  if (token.startsWith("APP_USR-")) return "production";
  return "unknown";
}

/** Mercado Pago sandbox exige e-mail @testuser.com em pagamentos. */
export function resolveMercadoPagoSandboxPayerEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.toLowerCase().endsWith("@testuser.com")) return trimmed;
  const local = trimmed.split("@")[0]?.trim().replace(/[^a-zA-Z0-9._-]/g, "") || "test";
  return `${local}@testuser.com`;
}

function inferDefaultBillingMode(): MercadoPagoBillingMode {
  const sandboxToken = resolveMercadoPagoAccessTokenForMode("sandbox");
  const productionToken = resolveMercadoPagoAccessTokenForMode("production");
  if (sandboxToken && !productionToken) return "sandbox";
  if (productionToken && !sandboxToken) return "production";

  const fallback = config.mercadopagoAccessToken.trim();
  const inferred = inferMercadoPagoTokenMode(fallback);
  return inferred === "unknown" ? "sandbox" : inferred;
}

export function readMercadoPagoBillingPlatformSettings(raw: unknown): MercadoPagoBillingPlatformSettings {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const mode = o.mode === "production" ? "production" : DEFAULT_SETTINGS.mode;
  return { mode };
}

export async function getMercadoPagoBillingPlatformSettings(): Promise<MercadoPagoBillingPlatformSettings> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: MERCADOPAGO_BILLING_PLATFORM_KEY },
  });
  if (!row?.value) {
    return { mode: inferDefaultBillingMode() };
  }
  return readMercadoPagoBillingPlatformSettings(row.value);
}

export async function saveMercadoPagoBillingPlatformSettings(
  value: MercadoPagoBillingPlatformSettings,
): Promise<MercadoPagoBillingPlatformSettings> {
  const normalized = readMercadoPagoBillingPlatformSettings(value);
  await prisma.platformSetting.upsert({
    where: { key: MERCADOPAGO_BILLING_PLATFORM_KEY },
    create: { key: MERCADOPAGO_BILLING_PLATFORM_KEY, value: normalized },
    update: { value: normalized },
  });
  return normalized;
}

export async function patchMercadoPagoBillingPlatformSettings(input: {
  mode: MercadoPagoBillingMode;
}): Promise<MercadoPagoBillingPlatformSettings> {
  return saveMercadoPagoBillingPlatformSettings({ mode: input.mode });
}

export function resolveMercadoPagoAccessTokenForMode(mode: MercadoPagoBillingMode): string {
  const sandbox =
    config.mercadopagoSandboxAccessToken.trim() ||
    (mode === "sandbox" ? config.mercadopagoAccessToken.trim() : "");
  const production =
    config.mercadopagoProductionAccessToken.trim() ||
    (mode === "production" ? config.mercadopagoAccessToken.trim() : "");

  if (mode === "sandbox") return sandbox;
  return production;
}

export function resolveMercadoPagoPublicKeyForMode(mode: MercadoPagoBillingMode): string {
  const sandbox =
    config.mercadopagoSandboxPublicKey.trim() ||
    (mode === "sandbox" ? config.mercadopagoPublicKey.trim() : "");
  const production =
    config.mercadopagoProductionPublicKey.trim() ||
    (mode === "production" ? config.mercadopagoPublicKey.trim() : "");

  if (mode === "sandbox") return sandbox;
  return production;
}

export function assertMercadoPagoTokenMatchesMode(
  accessToken: string,
  mode: MercadoPagoBillingMode,
): void {
  const inferred = inferMercadoPagoTokenMode(accessToken);
  if (inferred === "unknown" || inferred === mode) return;

  throw new BillingError(
    mode === "sandbox"
      ? "O Access Token activo parece ser de produção (APP_USR-). Defina MERCADOPAGO_SANDBOX_ACCESS_TOKEN com credencial TEST- no .env ou altere o modo para produção no Super Admin."
      : "O Access Token activo parece ser de sandbox (TEST-). Defina MERCADOPAGO_PRODUCTION_ACCESS_TOKEN no .env ou altere o modo para sandbox no Super Admin.",
    "mercadopago_token_mode_mismatch",
  );
}

function maskTokenPreview(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export async function getMercadoPagoBillingModeDiagnostics(): Promise<MercadoPagoBillingModeDiagnostics> {
  const settings = await getMercadoPagoBillingPlatformSettings();
  const accessToken = resolveMercadoPagoAccessTokenForMode(settings.mode);
  const publicKey = resolveMercadoPagoPublicKeyForMode(settings.mode);
  const tokenMode = inferMercadoPagoTokenMode(accessToken);

  return {
    mode: settings.mode,
    activeAccessTokenConfigured: Boolean(accessToken),
    activePublicKeyConfigured: Boolean(publicKey),
    tokenMode,
    tokenModeMismatch: tokenMode !== "unknown" && tokenMode !== settings.mode,
    activeAccessTokenPreview: accessToken ? maskTokenPreview(accessToken) : null,
    activePublicKeyPreview: publicKey ? maskTokenPreview(publicKey) : null,
  };
}

export async function resolvePlatformMercadoPagoAccessToken(): Promise<string> {
  const settings = await getMercadoPagoBillingPlatformSettings();
  const token = resolveMercadoPagoAccessTokenForMode(settings.mode);
  if (!token) {
    throw new BillingError(
      settings.mode === "sandbox"
        ? "Mercado Pago sandbox access token is not configured (MERCADOPAGO_SANDBOX_ACCESS_TOKEN or MERCADOPAGO_ACCESS_TOKEN with mode sandbox)"
        : "Mercado Pago production access token is not configured (MERCADOPAGO_PRODUCTION_ACCESS_TOKEN or MERCADOPAGO_ACCESS_TOKEN with mode production)",
      "mercadopago_not_configured",
    );
  }
  assertMercadoPagoTokenMatchesMode(token, settings.mode);
  return token;
}

export async function isMercadoPagoSandboxBillingMode(): Promise<boolean> {
  const settings = await getMercadoPagoBillingPlatformSettings();
  return settings.mode === "sandbox";
}
