import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { clientIp } from "./audit.js";

/** Chave em `platform_settings` — configurável no painel super admin. */
export const TURNSTILE_PLATFORM_KEY = "cloudflare_turnstile";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileConfig = {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
};

export type TurnstilePublicConfig = {
  enabled: boolean;
  siteKey: string | null;
};

export function readTurnstileSettings(raw: unknown): TurnstileConfig {
  const o = raw && typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    enabled: o.enabled === true,
    siteKey: String(o.siteKey ?? "").trim(),
    secretKey: String(o.secretKey ?? "").trim(),
  };
}

export function parseTurnstileValue(raw: unknown): TurnstileConfig | null {
  const cfg = readTurnstileSettings(raw);
  if (!cfg.siteKey || !cfg.secretKey) return null;
  return cfg;
}

export async function getTurnstileConfigFromDb(): Promise<TurnstileConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: TURNSTILE_PLATFORM_KEY },
  });
  return parseTurnstileValue(row?.value);
}

export async function getPublicTurnstileConfig(): Promise<TurnstilePublicConfig> {
  const config = await getTurnstileConfigFromDb();
  if (!config?.enabled) {
    return { enabled: false, siteKey: null };
  }
  return { enabled: true, siteKey: config.siteKey };
}

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string,
): Promise<boolean> {
  const body = new URLSearchParams();
  body.set("secret", secretKey);
  body.set("response", token);
  if (remoteIp?.trim()) body.set("remoteip", remoteIp.trim());

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Quando Turnstile está activo, exige token válido; caso contrário deixa passar. */
export async function enforceTurnstileIfEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
  turnstileToken: string | undefined,
): Promise<boolean> {
  const config = await getTurnstileConfigFromDb();
  if (!config?.enabled) return true;

  if (!config.siteKey.trim() || !config.secretKey.trim()) {
    request.log.warn("turnstile_enabled_but_incomplete_config");
    reply.status(503).send({
      error: "Service Unavailable",
      message: "Turnstile is enabled but not fully configured",
      statusCode: 503,
    });
    return false;
  }

  const token = turnstileToken?.trim();
  if (!token) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Security verification required",
      code: "turnstile_required",
      statusCode: 400,
    });
    return false;
  }

  const ok = await verifyTurnstileToken(token, config.secretKey, clientIp(request));
  if (!ok) {
    reply.status(400).send({
      error: "Bad Request",
      message: "Security verification failed",
      code: "turnstile_failed",
      statusCode: 400,
    });
    return false;
  }

  return true;
}
