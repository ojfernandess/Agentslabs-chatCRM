const SECRET_KEYS = new Set([
  "apiKey",
  "api_key",
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "secret",
  "webhookSecret",
  "webhook_secret",
  "inboxTokenHash",
  "inbox_token_hash",
  "tokenHash",
  "token_hash",
  "sipPasswordEnc",
  "sip_password_enc",
  "refreshToken",
  "refresh_token",
  "accessToken",
  "access_token",
  "privateKey",
  "private_key",
  "credentials",
  "authorization",
]);

const REDACTED = "[REDACTED]";

/** Remove credenciais, tokens e segredos de objetos antes de expor via MCP. */
export function sanitizeForMcp<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^(ocu_|ocb_|ocp_|ocm_|sk-|Bearer\s)/i.test(value)) {
      return REDACTED as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForMcp(v, depth + 1)) as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k) || /secret|password|token|credential|apikey/i.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = sanitizeForMcp(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}

/** Indica se llmConfig tem chave configurada sem expor o valor. */
export function llmConfigSafeSummary(llmConfig: unknown): Record<string, unknown> {
  if (!llmConfig || typeof llmConfig !== "object") return {};
  const c = llmConfig as Record<string, unknown>;
  return sanitizeForMcp({
    provider: c.provider,
    model: c.model,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    apiBaseUrl: c.apiBaseUrl,
    hasLlmKey: Boolean(c.apiKey),
  });
}
