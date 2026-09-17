import crypto from "node:crypto";
import { prisma } from "../../db.js";
import { config, getPublicOrigin, getWebAppPublicOrigin, isMercadoPagoBillingConfigured } from "../../config.js";
import { BillingError } from "./StripeCustomerService.js";
import {
  decryptPaymentProviderSecret,
  encryptPaymentProviderSecret,
  isConnectedPaymentProvider,
  MASKED_PAYMENT_SECRET,
  mercadoPagoConnectionToClientRow,
  type MercadoPagoConnectionClientRow,
} from "./paymentProviderConfig.js";

const MP_API_BASE = "https://api.mercadopago.com";
const MP_AUTH_BASE = "https://auth.mercadopago.com.br";

type MercadoPagoUserProfile = {
  id?: number | string;
  nickname?: string;
  email?: string;
};

type OAuthTokenResponse = {
  access_token?: string;
  public_key?: string;
  user_id?: number | string;
  refresh_token?: string;
  live_mode?: boolean;
};

function mercadoPagoOAuthAvailable(): boolean {
  return Boolean(config.mercadopagoClientId && config.mercadopagoClientSecret);
}

export function mercadoPagoOAuthRedirectUri(): string {
  const configured = config.mercadopagoOAuthRedirectUri.trim();
  if (configured) return configured;
  return `${getPublicOrigin()}/api/v1/billing/providers/mercadopago/oauth/callback`;
}

function billingReturnUrl(query: Record<string, string>): string {
  const params = new URLSearchParams({ section: "billing", ...query });
  return `${getWebAppPublicOrigin()}/settings?${params.toString()}`;
}

function createOAuthState(organizationId: string): string {
  const payload = `${organizationId}:${Date.now()}`;
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

function parseOAuthState(state: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new BillingError("Invalid OAuth state", "mercadopago_oauth_invalid_state");
  }
  const parts = decoded.split(":");
  if (parts.length !== 3) {
    throw new BillingError("Invalid OAuth state", "mercadopago_oauth_invalid_state");
  }
  const [organizationId, ts, sig] = parts;
  const payload = `${organizationId}:${ts}`;
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(payload).digest("hex");
  if (sig !== expected) {
    throw new BillingError("Invalid OAuth state signature", "mercadopago_oauth_invalid_state");
  }
  const ageMs = Date.now() - Number(ts);
  if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) {
    throw new BillingError("OAuth state expired", "mercadopago_oauth_state_expired");
  }
  return organizationId;
}

async function fetchMercadoPagoUser(accessToken: string): Promise<MercadoPagoUserProfile> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${MP_API_BASE}/users/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new BillingError(
        "Mercado Pago rejected the access token",
        "mercadopago_invalid_credentials",
      );
    }
    return (await res.json()) as MercadoPagoUserProfile;
  } catch (err) {
    if (err instanceof BillingError) throw err;
    throw new BillingError("Could not validate Mercado Pago credentials", "mercadopago_unreachable");
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeOAuthCode(code: string): Promise<OAuthTokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${MP_API_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.mercadopagoClientId,
        client_secret: config.mercadopagoClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: mercadoPagoOAuthRedirectUri(),
      }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as OAuthTokenResponse & { message?: string };
    if (!res.ok || !body.access_token) {
      throw new BillingError(
        body.message ?? "Mercado Pago OAuth token exchange failed",
        "mercadopago_oauth_failed",
      );
    }
    return body;
  } catch (err) {
    if (err instanceof BillingError) throw err;
    throw new BillingError("Mercado Pago OAuth token exchange failed", "mercadopago_oauth_failed");
  } finally {
    clearTimeout(timer);
  }
}

async function upsertMercadoPagoConnection(input: {
  organizationId: string;
  accessToken: string;
  publicKey?: string | null;
  externalUserId?: string | null;
  environment: "sandbox" | "production";
  metadata?: Record<string, unknown>;
}): Promise<MercadoPagoConnectionClientRow> {
  await prisma.paymentProviderConnection.upsert({
    where: {
      organizationId_provider: { organizationId: input.organizationId, provider: "mercadopago" },
    },
    create: {
      organizationId: input.organizationId,
      provider: "mercadopago",
      status: "connected",
      environment: input.environment,
      accessTokenEnc: encryptPaymentProviderSecret(input.accessToken),
      publicKey: input.publicKey?.trim() || null,
      externalUserId: input.externalUserId?.trim() || null,
      metadata: input.metadata ?? {},
      connectedAt: new Date(),
    },
    update: {
      status: "connected",
      environment: input.environment,
      accessTokenEnc: encryptPaymentProviderSecret(input.accessToken),
      publicKey: input.publicKey?.trim() || null,
      externalUserId: input.externalUserId?.trim() || null,
      metadata: input.metadata ?? {},
      connectedAt: new Date(),
    },
  });

  const row = await prisma.paymentProviderConnection.findUnique({
    where: {
      organizationId_provider: { organizationId: input.organizationId, provider: "mercadopago" },
    },
  });
  return mercadoPagoConnectionToClientRow(row, mercadoPagoOAuthAvailable());
}

export async function getMercadoPagoConnectionClientRow(
  organizationId: string,
): Promise<MercadoPagoConnectionClientRow> {
  const row = await prisma.paymentProviderConnection.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "mercadopago" },
    },
  });
  return mercadoPagoConnectionToClientRow(row, mercadoPagoOAuthAvailable());
}

export async function resolveMercadoPagoAccessToken(organizationId: string): Promise<string | null> {
  const row = await prisma.paymentProviderConnection.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "mercadopago" },
    },
    select: { accessTokenEnc: true, status: true },
  });
  if (isConnectedPaymentProvider(row)) {
    const token = decryptPaymentProviderSecret(row?.accessTokenEnc);
    if (token) return token;
  }
  if (isMercadoPagoBillingConfigured()) {
    return config.mercadopagoAccessToken;
  }
  return null;
}

export async function connectMercadoPagoManual(input: {
  organizationId: string;
  accessToken: string;
  publicKey?: string | null;
  environment?: "sandbox" | "production";
}): Promise<MercadoPagoConnectionClientRow> {
  const accessToken = input.accessToken.trim();
  if (!accessToken || accessToken === MASKED_PAYMENT_SECRET) {
    throw new BillingError("Access token is required", "mercadopago_access_token_required");
  }

  const profile = await fetchMercadoPagoUser(accessToken);
  return upsertMercadoPagoConnection({
    organizationId: input.organizationId,
    accessToken,
    publicKey: input.publicKey,
    externalUserId: profile.id != null ? String(profile.id) : null,
    environment: input.environment ?? "sandbox",
    metadata: {
      nickname: profile.nickname ?? null,
      email: profile.email ?? null,
      connectedVia: "manual",
    },
  });
}

export async function disconnectMercadoPago(organizationId: string): Promise<MercadoPagoConnectionClientRow> {
  await prisma.paymentProviderConnection.upsert({
    where: {
      organizationId_provider: { organizationId, provider: "mercadopago" },
    },
    create: {
      organizationId,
      provider: "mercadopago",
      status: "disconnected",
      environment: "sandbox",
    },
    update: {
      status: "disconnected",
      accessTokenEnc: null,
      publicKey: null,
      externalUserId: null,
      connectedAt: null,
      metadata: {},
    },
  });
  return getMercadoPagoConnectionClientRow(organizationId);
}

export async function testMercadoPagoConnection(organizationId: string): Promise<{ ok: true; externalUserId: string | null }> {
  const token = await resolveMercadoPagoAccessToken(organizationId);
  if (!token) {
    throw new BillingError("Mercado Pago is not connected", "mercadopago_not_connected");
  }
  const profile = await fetchMercadoPagoUser(token);
  return { ok: true, externalUserId: profile.id != null ? String(profile.id) : null };
}

export async function startMercadoPagoOAuth(organizationId: string): Promise<{ authorizationUrl: string }> {
  if (!mercadoPagoOAuthAvailable()) {
    throw new BillingError(
      "Mercado Pago OAuth is not configured on this server",
      "mercadopago_oauth_not_configured",
    );
  }
  const state = createOAuthState(organizationId);
  const params = new URLSearchParams({
    client_id: config.mercadopagoClientId,
    response_type: "code",
    platform_id: "mp",
    redirect_uri: mercadoPagoOAuthRedirectUri(),
    state,
  });
  return { authorizationUrl: `${MP_AUTH_BASE}/authorization?${params.toString()}` };
}

export async function handleMercadoPagoOAuthCallback(input: {
  code?: string;
  state?: string;
  error?: string;
}): Promise<{ redirectUrl: string }> {
  if (input.error?.trim()) {
    return { redirectUrl: billingReturnUrl({ mp: "error" }) };
  }
  if (!input.code?.trim() || !input.state?.trim()) {
    return { redirectUrl: billingReturnUrl({ mp: "error" }) };
  }

  try {
    const organizationId = parseOAuthState(input.state);
    const token = await exchangeOAuthCode(input.code.trim());
    const profile = await fetchMercadoPagoUser(token.access_token!);
    await upsertMercadoPagoConnection({
      organizationId,
      accessToken: token.access_token!,
      publicKey: token.public_key ?? null,
      externalUserId: token.user_id != null ? String(token.user_id) : profile.id != null ? String(profile.id) : null,
      environment: token.live_mode ? "production" : "sandbox",
      metadata: {
        connectedVia: "oauth",
        nickname: profile.nickname ?? null,
      },
    });
    return { redirectUrl: billingReturnUrl({ mp: "connected" }) };
  } catch {
    return { redirectUrl: billingReturnUrl({ mp: "error" }) };
  }
}

export function isMercadoPagoConnectedForOrganizationSync(row: {
  status: string;
  accessTokenEnc: string | null;
} | null): boolean {
  return isConnectedPaymentProvider(row) && Boolean(row?.accessTokenEnc);
}
