import type { PaymentProvider, PaymentProviderConnection } from "@prisma/client";
import { encrypt, decrypt } from "../encryption.js";

export const MASKED_PAYMENT_SECRET = "••••••••";

export type MercadoPagoConnectionClientRow = {
  provider: "mercadopago";
  status: string;
  environment: string;
  connected: boolean;
  hasAccessToken: boolean;
  publicKey: string | null;
  externalUserId: string | null;
  externalUserIdMasked: string | null;
  connectedAt: string | null;
  lastError: string | null;
  oauthAvailable: boolean;
};

export function encryptPaymentProviderSecret(value: string): string {
  return encrypt(value.trim());
}

export function decryptPaymentProviderSecret(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  return decrypt(stored);
}

export function maskExternalUserId(id: string | null | undefined): string | null {
  const v = id?.trim();
  if (!v) return null;
  if (v.length <= 4) return "****";
  return `****${v.slice(-4)}`;
}

export function mercadoPagoConnectionToClientRow(
  row: PaymentProviderConnection | null,
  oauthAvailable: boolean,
): MercadoPagoConnectionClientRow {
  if (!row) {
    return {
      provider: "mercadopago",
      status: "disconnected",
      environment: "sandbox",
      connected: false,
      hasAccessToken: false,
      publicKey: null,
      externalUserId: null,
      externalUserIdMasked: null,
      connectedAt: null,
      lastError: null,
      oauthAvailable,
    };
  }

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const lastError = typeof metadata.lastError === "string" ? metadata.lastError : null;

  return {
    provider: "mercadopago",
    status: row.status,
    environment: row.environment,
    connected: row.status === "connected",
    hasAccessToken: Boolean(row.accessTokenEnc),
    publicKey: row.publicKey,
    externalUserId: row.externalUserId,
    externalUserIdMasked: maskExternalUserId(row.externalUserId),
    connectedAt: row.connectedAt?.toISOString() ?? null,
    lastError,
    oauthAvailable,
  };
}

export function isConnectedPaymentProvider(row: Pick<PaymentProviderConnection, "status"> | null): boolean {
  return row?.status === "connected";
}

export function paymentProviderLabel(provider: PaymentProvider): string {
  return provider === "mercadopago" ? "Mercado Pago" : "Stripe";
}
