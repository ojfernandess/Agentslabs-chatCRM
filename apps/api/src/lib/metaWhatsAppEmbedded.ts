import { prisma } from "../db.js";

export const WHATSAPP_EMBEDDED_PLATFORM_KEY = "whatsapp_embedded";

export type WhatsAppEmbeddedPlatformConfig = {
  appId: string;
  appSecret: string;
  configurationId: string;
  apiVersion: string;
  webhookVerifyToken: string;
};

export function normalizeApiVersion(v: string): string {
  const t = v.trim();
  if (!t) return "v22.0";
  return t.startsWith("v") ? t : `v${t}`;
}

export async function getWhatsAppEmbeddedConfig(): Promise<WhatsAppEmbeddedPlatformConfig | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key: WHATSAPP_EMBEDDED_PLATFORM_KEY } });
  if (!row?.value || typeof row.value !== "object" || row.value === null) return null;
  const v = row.value as Record<string, unknown>;
  const appId = String(v.appId ?? "").trim();
  const appSecret = String(v.appSecret ?? "").trim();
  const configurationId = String(v.configurationId ?? "").trim();
  const apiVersion = normalizeApiVersion(String(v.apiVersion ?? "v22.0"));
  const webhookVerifyToken = String(v.webhookVerifyToken ?? "").trim();
  if (!appId || !appSecret || !configurationId || !webhookVerifyToken) return null;
  return { appId, appSecret, configurationId, apiVersion, webhookVerifyToken };
}

export async function getWhatsAppEmbeddedPublicConfig(): Promise<{
  appId: string;
  configurationId: string;
  apiVersion: string;
} | null> {
  const full = await getWhatsAppEmbeddedConfig();
  if (!full) return null;
  return {
    appId: full.appId,
    configurationId: full.configurationId,
    apiVersion: full.apiVersion,
  };
}

export async function exchangeEmbeddedSignupCode(
  code: string,
  cfg: WhatsAppEmbeddedPlatformConfig,
): Promise<string> {
  const v = normalizeApiVersion(cfg.apiVersion);
  const url = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("code", code);
  let res = await fetch(url.toString());
  let data = (await res.json()) as { access_token?: string; error?: { message?: string } };

  if (!res.ok || !data.access_token) {
    const u2 = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
    u2.searchParams.set("client_id", cfg.appId);
    u2.searchParams.set("client_secret", cfg.appSecret);
    u2.searchParams.set("redirect_uri", "https://www.facebook.com/connect/login_success.html");
    u2.searchParams.set("code", code);
    res = await fetch(u2.toString());
    data = (await res.json()) as { access_token?: string; error?: { message?: string } };
  }

  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? `Token exchange failed (${res.status})`);
  }
  return data.access_token;
}

export async function exchangeForLongLivedToken(
  shortLived: string,
  cfg: WhatsAppEmbeddedPlatformConfig,
): Promise<string> {
  const v = normalizeApiVersion(cfg.apiVersion);
  const url = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("fb_exchange_token", shortLived);
  const res = await fetch(url.toString());
  const data = (await res.json()) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !data.access_token) {
    return shortLived;
  }
  return data.access_token;
}

export async function subscribeWabaToApp(
  wabaId: string,
  accessToken: string,
  cfg: WhatsAppEmbeddedPlatformConfig,
): Promise<void> {
  const v = normalizeApiVersion(cfg.apiVersion);
  const url = `https://graph.facebook.com/${v}/${wabaId}/subscribed_apps`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`subscribed_apps failed: ${res.status} ${text}`);
  }
}

export async function fetchFirstPhoneNumberId(
  wabaId: string,
  accessToken: string,
  cfg: WhatsAppEmbeddedPlatformConfig,
): Promise<string | null> {
  const v = normalizeApiVersion(cfg.apiVersion);
  const url = `https://graph.facebook.com/${v}/${wabaId}/phone_numbers`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as { data?: { id: string }[]; error?: { message?: string } };
  if (!res.ok || !data.data?.length) {
    return null;
  }
  return data.data[0].id;
}
