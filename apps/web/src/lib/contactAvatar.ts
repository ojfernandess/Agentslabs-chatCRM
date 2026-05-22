import { api } from "@/lib/api";

const TOKEN_KEY = "openconduit_token";

/** JWT da sessão (memória ou localStorage) — evita 401 quando <img> carrega antes do ApiClient. */
export function getSessionToken(): string | null {
  const fromClient = api.getToken();
  if (fromClient) return fromClient;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * URL do avatar em cache no servidor (estilo Chatwoot `thumbnail`).
 * O browser faz cache HTTP; sync em background preenche o ficheiro.
 */
export function contactProfilePictureSrc(
  contactId: string,
  thumbnailPath?: string | null,
): string | null {
  const path =
    thumbnailPath?.trim() ||
    (contactId ? `/api/v1/contacts/${encodeURIComponent(contactId)}/profile-picture` : "");
  if (!path) return null;
  const token = getSessionToken();
  if (!token) return path.startsWith("/") ? path : null;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}access_token=${encodeURIComponent(token)}`;
}

export function needsProfilePictureProxy(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u.startsWith("http")) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("fbcdn.net") ||
      host.includes("facebook.com") ||
      host.includes("fbsbx.com") ||
      host.includes("whatsapp.net") ||
      host.endsWith(".cdninstagram.com")
    );
  } catch {
    return false;
  }
}
