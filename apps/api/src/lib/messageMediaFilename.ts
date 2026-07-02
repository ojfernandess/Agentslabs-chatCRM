/** Nome: 32 hex + extensão (ex.: gravações WebM/OGG do browser). */
export const MESSAGE_MEDIA_FILENAME_RE = /^[a-f0-9]{32}\.[a-z0-9]+$/i;

/** Fotos de perfil enviadas antes da normalização do nome (compatibilidade). */
export const USER_AVATAR_MEDIA_FILENAME_RE =
  /^user-avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-f0-9]+\.[a-z0-9]+$/i;

export function isPublicMediaFilename(name: string): boolean {
  return MESSAGE_MEDIA_FILENAME_RE.test(name) || USER_AVATAR_MEDIA_FILENAME_RE.test(name);
}

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

/** Nome de ficheiro a partir da URL de media (ex.: `…/media/abc.pdf` → `abc.pdf`). */
export function filenameFromMediaUrl(mediaUrl: string | null | undefined): string | undefined {
  const extracted = extractMessageMediaFilename(mediaUrl);
  if (extracted) return extracted;
  if (!mediaUrl || typeof mediaUrl !== "string") return undefined;
  try {
    const path = new URL(mediaUrl).pathname;
    const last = path.split("/").pop();
    if (!last) return undefined;
    const decoded = decodeURIComponent(last.split("?")[0] ?? "");
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    const tail = mediaUrl.split("/").pop() ?? "";
    const decoded = decodeURIComponent(tail.split("?")[0] ?? "");
    return decoded.length > 0 ? decoded : undefined;
  }
}
