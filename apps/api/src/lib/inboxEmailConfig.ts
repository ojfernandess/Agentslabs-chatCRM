export const MASKED_EMAIL_SECRET = "••••••••";

function asRecord(cfg: unknown): Record<string, unknown> | null {
  return cfg !== null && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : null;
}

function isMaskedSecret(v: string): boolean {
  return v === MASKED_EMAIL_SECRET;
}

export function maskEmailChannelConfigForClient(cfg: unknown): unknown {
  const c = asRecord(cfg);
  if (!c) return cfg;
  const out = { ...c };
  if (
    typeof out.emailSmtpPassword === "string" &&
    out.emailSmtpPassword &&
    !isMaskedSecret(out.emailSmtpPassword)
  ) {
    out.emailSmtpPassword = MASKED_EMAIL_SECRET;
  }
  return out;
}
