const MAX_PROVIDER_ERROR_LENGTH = 500;

export function sanitizeProviderErrorMessage(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let text = raw.trim().replace(/\s+/g, " ");
  text = text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  if (text.length <= MAX_PROVIDER_ERROR_LENGTH) return text;
  return `${text.slice(0, MAX_PROVIDER_ERROR_LENGTH - 1)}…`;
}

type MetaWebhookStatusError = {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
};

export function formatMetaWebhookStatusError(
  errors?: MetaWebhookStatusError[] | null,
): string | undefined {
  const err = errors?.[0];
  if (!err) return undefined;
  const parts: string[] = [];
  if (err.code != null) parts.push(String(err.code));
  if (err.title?.trim()) parts.push(err.title.trim());
  if (err.message?.trim()) parts.push(err.message.trim());
  const details = err.error_data?.details?.trim();
  if (details) parts.push(details);
  const joined = parts.join(" — ");
  return joined || undefined;
}
