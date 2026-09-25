export function pickEscalationTransferFallbackBody(
  primaryBody: string,
  modelReply?: string | null,
): string | null {
  const fallback = (modelReply ?? "").trim();
  if (!fallback) return null;
  if (fallback === primaryBody.trim()) return null;
  return fallback;
}
