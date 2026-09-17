import { config, getWebAppPublicOrigin } from "../../../config.js";
import { BillingError } from "../StripeCustomerService.js";

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

    const payload = (await res.json().catch(() => ({}))) as T & {
      message?: string;
      error?: string;
      cause?: Array<{ code?: string; description?: string }>;
    };

    if (!res.ok) {
      const detail =
        payload.message ??
        payload.error ??
        payload.cause?.[0]?.description ??
        `Mercado Pago API error (${res.status})`;
      throw new MercadoPagoApiError(detail, res.status, payload.error);
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
