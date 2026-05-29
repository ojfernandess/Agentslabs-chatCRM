/** Nome: 32 hex + extensão (ex.: gravações WebM/OGG do browser). */
export const MESSAGE_MEDIA_FILENAME_RE = /^[a-f0-9]{32}\.[a-z0-9]+$/i;

/** Extrai o nome do ficheiro de URLs proxy ou MinIO público. */
export function extractMessageMediaFilename(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("telegram:")) return null;

  try {
    const parsed = new URL(trimmed, "http://local.invalid");
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return null;
    const decoded = decodeURIComponent(last);
    return MESSAGE_MEDIA_FILENAME_RE.test(decoded) ? decoded : null;
  } catch {
    const tail = trimmed.split("/").pop() ?? "";
    const decoded = decodeURIComponent(tail.split("?")[0] ?? "");
    return MESSAGE_MEDIA_FILENAME_RE.test(decoded) ? decoded : null;
  }
}
