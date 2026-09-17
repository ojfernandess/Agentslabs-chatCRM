import { config, getWebAppPublicOrigin } from "../../../config.js";
import { BillingError } from "../StripeCustomerService.js";
import { resolveMercadoPagoAccessToken } from "../MercadoPagoConnectionService.js";
import {
  inferMercadoPagoTokenMode,
  isMercadoPagoSandboxBillingMode,
  resolveMercadoPagoSandboxPayerEmail,
  resolvePlatformMercadoPagoAccessToken,
  type MercadoPagoBillingMode,
} from "../mercadoPagoBillingSettings.js";

export {
  inferMercadoPagoTokenMode,
  isMercadoPagoSandboxBillingMode,
  resolvePlatformMercadoPagoAccessToken,
};

const MP_API_BASE = "https://api.mercadopago.com";
const REQUEST_TIMEOUT_MS = 20_000;

export type MercadoPagoHttpMethod = "GET" | "POST" | "PUT";

export class MercadoPagoApiError extends BillingError {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly mpError?: string,
  ) {
    super(message, "mercadopago_api_error");
    this.name = "MercadoPagoApiError";
  }
}

type MercadoPagoErrorPayload = {
  message?: string;
  error?: string;
  cause?: Array<{ code?: string; description?: string }>;
};

function formatMercadoPagoError(payload: MercadoPagoErrorPayload, status: number): string {
  const parts: string[] = [];
  if (payload.message?.trim()) parts.push(payload.message.trim());
  if (payload.error?.trim() && payload.error.trim() !== payload.message?.trim()) {
    parts.push(payload.error.trim());
  }
  for (const item of payload.cause ?? []) {
    if (item.description?.trim()) parts.push(item.description.trim());
    else if (item.code?.trim()) parts.push(item.code.trim());
  }
  return parts.length > 0 ? parts.join(" — ") : `Mercado Pago API error (${status})`;
}

export function isMercadoPagoSandboxAccessToken(accessToken: string): boolean {
  return accessToken.trim().startsWith("TEST-");
}

/** @deprecated Prefer isMercadoPagoSandboxBillingMode() — respects Super Admin mode. */
export function resolveMercadoPagoSandboxPayerEmailFromToken(accessToken: string, email: string): string {
  if (!isMercadoPagoSandboxAccessToken(accessToken)) return email.trim();
  return resolveMercadoPagoSandboxPayerEmail(email);
}

function mercadoPagoLiveCredentialsMessage(mode?: MercadoPagoBillingMode): string {
  if (mode === "sandbox") {
    return (
      "Mercado Pago recusou credenciais de produção no modo Sandbox. " +
      "Defina MERCADOPAGO_SANDBOX_ACCESS_TOKEN com o Access Token da aba Credenciais de teste (MP Developers → Suas integrações → Testes). " +
      "Não use o token de Produção nem MERCADOPAGO_ACCESS_TOKEN legado se ele for o mesmo token de produção."
    );
  }
  return (
    "Mercado Pago recusou credenciais de produção neste ambiente. " +
    "Confirme MERCADOPAGO_PRODUCTION_ACCESS_TOKEN e que a conta vendedora está habilitada para Pix."
  );
}

function isMercadoPagoPixKeyMissingError(payload: MercadoPagoErrorPayload, message: string): boolean {
  if (message.toLowerCase().includes("without key enabled for qr")) return true;
  return (payload.cause ?? []).some((item) => String(item.code ?? "").trim() === "13253");
}

type MercadoPagoUserProfile = {
  tags?: string[];
};

/** Valida token via /users/me — MP marca contas de teste com tag test_user. */
export async function assertMercadoPagoAccessTokenMatchesBillingMode(
  accessToken: string,
  mode: MercadoPagoBillingMode,
): Promise<void> {
  const profile = await mercadoPagoRequest<MercadoPagoUserProfile>({
    accessToken,
    method: "GET",
    path: "/users/me",
  });
  const isTestUser = (profile.tags ?? []).includes("test_user");

  if (mode === "sandbox" && !isTestUser) {
    throw new BillingError(
      "O Access Token activo não é de teste. Defina MERCADOPAGO_SANDBOX_ACCESS_TOKEN com credenciais da aba Credenciais de teste no MP Developers (Suas integrações → Detalhes → Testes).",
      "mercadopago_sandbox_token_required",
    );
  }
  if (mode === "production" && isTestUser) {
    throw new BillingError(
      "O Access Token activo é de teste. Defina MERCADOPAGO_PRODUCTION_ACCESS_TOKEN com credenciais de Produção ou altere o modo para Sandbox no Super Admin.",
      "mercadopago_production_token_required",
    );
  }
}

export function mercadoPagoBillingErrorHttpStatus(err: BillingError): number {
  if (
    err.code === "mercadopago_not_configured" ||
    err.code === "plan_free_mercadopago" ||
    err.code === "mercadopago_plan_sync_failed" ||
    err.code === "mercadopago_live_credentials_unauthorized" ||
    err.code === "mercadopago_sandbox_token_required" ||
    err.code === "mercadopago_production_token_required" ||
    err.code === "mercadopago_pix_key_required" ||
    err.code === "mercadopago_token_mode_mismatch" ||
    err.code === "mercadopago_pix_document_required" ||
    err.code === "billing_email_missing" ||
    err.code === "already_subscribed" ||
    err.code === "subscription_exists"
  ) {
    return 400;
  }
  if (err instanceof MercadoPagoApiError) {
    if (err.statusCode >= 400 && err.statusCode < 500) return 400;
    return 502;
  }
  if (err.code === "mercadopago_timeout" || err.code === "mercadopago_unreachable") {
    return 502;
  }
  return 400;
}

export async function mercadoPagoRequest<T>(input: {
  accessToken: string;
  method: MercadoPagoHttpMethod;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  billingMode?: MercadoPagoBillingMode;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    };
    if (input.idempotencyKey?.trim()) {
      headers["X-Idempotency-Key"] = input.idempotencyKey.trim();
    }

    const res = await fetch(`${MP_API_BASE}${input.path}`, {
      method: input.method,
      headers,
      body: input.body != null ? JSON.stringify(input.body) : undefined,
      signal: controller.signal,
    });

    const payload = (await res.json().catch(() => ({}))) as T & MercadoPagoErrorPayload;

    if (!res.ok) {
      const message = formatMercadoPagoError(payload, res.status);
      if (message.toLowerCase().includes("live credentials")) {
        throw new BillingError(
          mercadoPagoLiveCredentialsMessage(input.billingMode),
          "mercadopago_live_credentials_unauthorized",
        );
      }
      if (isMercadoPagoPixKeyMissingError(payload, message)) {
        throw new BillingError(
          "A conta Mercado Pago da plataforma não tem chave Pix activa para gerar QR Code. Cadastre uma chave Pix na conta vendedora (Mercado Pago → Pix → Gerenciar chaves) e confirme que MERCADOPAGO_PRODUCTION_ACCESS_TOKEN pertence a essa mesma conta.",
          "mercadopago_pix_key_required",
        );
      }
      throw new MercadoPagoApiError(message, res.status, payload.error);
    }

    return payload;
  } catch (err) {
    if (err instanceof BillingError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new BillingError("Mercado Pago request timed out", "mercadopago_timeout");
    }
    const detail = err instanceof Error ? err.message.trim() : "";
    throw new BillingError(
      detail ? `Could not reach Mercado Pago API (${detail})` : "Could not reach Mercado Pago API",
      "mercadopago_unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function mercadoPagoBillingBackUrl(): string {
  return `${getWebAppPublicOrigin()}/settings?section=billing`;
}

/** URL de retorno ao criar planos de assinatura — prefere checkout success configurado (HTTPS). */
export function mercadoPagoPlanBackUrl(): string {
  const configured = config.mercadopagoCheckoutSuccessUrl.trim();
  if (configured) return configured;
  return mercadoPagoBillingBackUrl();
}

/** Token MP da org (OAuth) ou plataforma — usado em checkout, polling e webhooks. */
export async function resolveMercadoPagoAccessTokenForBilling(
  organizationId: string,
  planOrganizationId?: string | null,
): Promise<string> {
  // Plano personalizado: cobrança na conta MP do dono do plano.
  if (planOrganizationId) {
    const planOwnerToken = await resolveMercadoPagoAccessToken(planOrganizationId);
    if (planOwnerToken) return planOwnerToken;
    throw new BillingError(
      "Mercado Pago is not connected for the organization that owns this plan",
      "mercadopago_not_configured",
    );
  }

  // Catálogo global SaaS: sempre credenciais da plataforma (ignora OAuth MP da org assinante).
  return resolvePlatformMercadoPagoAccessToken();
}
