import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

/** Hosts CDN WhatsApp/Facebook que falham no &lt;img&gt; directo no browser. */
function needsProfilePictureProxy(url: string): boolean {
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

type Props = {
  contactId: string;
  name: string;
  profilePictureUrl?: string | null;
  /** Indica cache local no servidor (lista de conversas). */
  hasAvatar?: boolean;
  className?: string;
  imgClassName?: string;
};

/**
 * Avatar via API autenticada (busca Evolution/Evolution Go e cache).
 * Fallback: URL pública directa quando não há provedor WhatsApp.
 */
export function ContactAvatar({
  contactId,
  name,
  profilePictureUrl,
  hasAvatar,
  className,
  imgClassName,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [apiFailed, setApiFailed] = useState(false);
  const [directFailed, setDirectFailed] = useState(false);

  const url = profilePictureUrl?.trim() ?? "";
  const tryApi = Boolean(contactId);
  const useDirectFallback = Boolean(url && !needsProfilePictureProxy(url) && apiFailed);

  useEffect(() => {
    if (!tryApi) {
      setBlobUrl(null);
      setApiFailed(false);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    setApiFailed(false);

    void (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/v1/contacts/${contactId}/profile-picture`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          if (!cancelled) setApiFailed(true);
          return;
        }
        const blob = await res.blob();
        if (cancelled || blob.size < 64) {
          if (!cancelled) setApiFailed(true);
          return;
        }
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
      } catch {
        if (!cancelled) setApiFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
      setBlobUrl(null);
    };
  }, [contactId, tryApi, hasAvatar, url]);

  const initials = useMemo(() => initialsFromName(name), [name]);
  const showApi = tryApi && blobUrl && !apiFailed;
  const showDirect = useDirectFallback && !directFailed;

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-200 text-[10px] font-bold uppercase text-ink-600 dark:bg-ink-700 dark:text-ink-300",
        className,
      )}
    >
      {showApi ? (
        <img src={blobUrl!} alt="" className={clsx("h-full w-full object-cover", imgClassName)} />
      ) : showDirect ? (
        <img
          src={url}
          alt=""
          className={clsx("h-full w-full object-cover", imgClassName)}
          onError={() => setDirectFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
