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
  // Legacy public keys; MP test Access Tokens also use APP_USR- (same as production).
  if (token.startsWith("TEST-")) return "sandbox";
  return "unknown";
}

function mercadoPagoDedicatedTokensMisconfigured(): boolean {
  const sandbox = config.mercadopagoSandboxAccessToken.trim();
  const production = config.mercadopagoProductionAccessToken.trim();
  return Boolean(sandbox && production && sandbox === production);
}

/** E-mail recomendado pelo MP para testes Pix (Checkout API / Orders). */
export const MERCADOPAGO_SANDBOX_PIX_PAYER_EMAIL = "test_user_br@testuser.com";

/** first_name APRO simula pagamento aprovado em sandbox (documentação MP). */
export const MERCADOPAGO_SANDBOX_PIX_PAYER_FIRST_NAME = "APRO";

/** Mercado Pago sandbox exige e-mail @testuser.com em pagamentos. */
export function resolveMercadoPagoSandboxPayerEmail(_email: string): string {
  return MERCADOPAGO_SANDBOX_PIX_PAYER_EMAIL;
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
  const sandboxDedicated = config.mercadopagoSandboxAccessToken.trim();
  const productionDedicated = config.mercadopagoProductionAccessToken.trim();
  const legacy = config.mercadopagoAccessToken.trim();

  if (mode === "sandbox") {
    if (sandboxDedicated) return sandboxDedicated;
    // Evita usar token de produção quando MERCADOPAGO_SANDBOX_* não está definido.
    if (legacy && legacy !== productionDedicated) return legacy;
    return "";
  }

  if (productionDedicated) return productionDedicated;
  if (legacy && legacy !== sandboxDedicated) return legacy;
  return "";
}

export function resolveMercadoPagoPublicKeyForMode(mode: MercadoPagoBillingMode): string {
  const sandboxDedicated = config.mercadopagoSandboxPublicKey.trim();
  const productionDedicated = config.mercadopagoProductionPublicKey.trim();
  const legacy = config.mercadopagoPublicKey.trim();

  if (mode === "sandbox") {
    if (sandboxDedicated) return sandboxDedicated;
    if (legacy && legacy !== productionDedicated) return legacy;
    return "";
  }

  if (productionDedicated) return productionDedicated;
  if (legacy && legacy !== sandboxDedicated) return legacy;
  return "";
}

export function assertMercadoPagoTokenMatchesMode(
  _accessToken: string,
  _mode: MercadoPagoBillingMode,
): void {
  if (mercadoPagoDedicatedTokensMisconfigured()) {
    throw new BillingError(
      "MERCADOPAGO_SANDBOX_ACCESS_TOKEN e MERCADOPAGO_PRODUCTION_ACCESS_TOKEN não podem ser iguais. Use credenciais de Teste e de Produção separadas no painel MP Developers.",
      "mercadopago_token_mode_mismatch",
    );
  }
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

  return {
    mode: settings.mode,
    activeAccessTokenConfigured: Boolean(accessToken),
    activePublicKeyConfigured: Boolean(publicKey),
    tokenMode: accessToken ? inferMercadoPagoTokenMode(accessToken) : "unknown",
    tokenModeMismatch: mercadoPagoDedicatedTokensMisconfigured(),
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
        ? "Mercado Pago sandbox access token is not configured. Set MERCADOPAGO_SANDBOX_ACCESS_TOKEN with Test credentials from MP Developers (Suas integrações → Testes → Credenciais de teste)."
        : "Mercado Pago production access token is not configured. Set MERCADOPAGO_PRODUCTION_ACCESS_TOKEN with Production credentials from MP Developers.",
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
