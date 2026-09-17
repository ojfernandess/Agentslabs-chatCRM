import { config, getWebAppPublicOrigin } from "../../../config.js";
import { BillingError } from "../StripeCustomerService.js";
import { resolveMercadoPagoAccessToken } from "../MercadoPagoConnectionService.js";

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

/** Mercado Pago sandbox exige e-mail @testuser.com em pagamentos. */
export function resolveMercadoPagoSandboxPayerEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.toLowerCase().endsWith("@testuser.com")) return trimmed;
  const local = trimmed.split("@")[0]?.trim().replace(/[^a-zA-Z0-9._-]/g, "") || "test";
  return `${local}@testuser.com`;
}

function mercadoPagoLiveCredentialsMessage(): string {
  return (
    "Mercado Pago recusou credenciais de produção neste ambiente. " +
    "Para testes, use Access Token de sandbox (prefixo TEST-) no MERCADOPAGO_ACCESS_TOKEN. " +
    "Em produção, confirme que todas as credenciais são do mesmo modo (teste ou produção)."
  );
}

export function mercadoPagoBillingErrorHttpStatus(err: BillingError): number {
  if (
    err.code === "mercadopago_not_configured" ||
    err.code === "plan_free_mercadopago" ||
    err.code === "mercadopago_plan_sync_failed"
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
    if (err instanceof MercadoPagoApiError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new BillingError("Mercado Pago request timed out", "mercadopago_timeout");
    }
    throw new BillingError("Could not reach Mercado Pago API", "mercadopago_unreachable");
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

export function resolvePlatformMercadoPagoAccessToken(): string {
  const token = config.mercadopagoAccessToken.trim();
  if (!token) {
    throw new BillingError(
      "Mercado Pago platform access token is not configured (MERCADOPAGO_ACCESS_TOKEN)",
      "mercadopago_not_configured",
    );
  }
  return token;
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
