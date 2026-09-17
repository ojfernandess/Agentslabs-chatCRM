import { config, getWebAppPublicOrigin } from "../../../config.js";
import { BillingError } from "../StripeCustomerService.js";
import { resolveMercadoPagoAccessToken } from "../MercadoPagoConnectionService.js";
import {
  inferMercadoPagoTokenMode,
  isMercadoPagoSandboxBillingMode,
  resolveMercadoPagoSandboxPayerEmail,
  resolvePlatformMercadoPagoAccessToken,
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

function mercadoPagoLiveCredentialsMessage(): string {
  return (
    "Mercado Pago recusou credenciais de produção neste ambiente. " +
    "No Super Admin, seleccione modo Sandbox e use MERCADOPAGO_SANDBOX_ACCESS_TOKEN com as credenciais de Teste do painel MP Developers. " +
    "Credenciais de teste também começam com APP_USR- — o modo activo é definido no Super Admin, não pelo prefixo do token."
  );
}

export function mercadoPagoBillingErrorHttpStatus(err: BillingError): number {
  if (
    err.code === "mercadopago_not_configured" ||
    err.code === "plan_free_mercadopago" ||
    err.code === "mercadopago_plan_sync_failed" ||
    err.code === "mercadopago_live_credentials_unauthorized" ||
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
        throw new BillingError(mercadoPagoLiveCredentialsMessage(), "mercadopago_live_credentials_unauthorized");
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
