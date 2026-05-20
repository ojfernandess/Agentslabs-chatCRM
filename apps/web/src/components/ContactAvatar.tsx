import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";

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
  className?: string;
  imgClassName?: string;
};

/**
 * Avatar: URL pública no img directo; CDN WhatsApp via API autenticada (evita 403).
 */
export function ContactAvatar({ contactId, name, profilePictureUrl, className, imgClassName }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [directFailed, setDirectFailed] = useState(false);
  const [proxyFailed, setProxyFailed] = useState(false);

  const url = profilePictureUrl?.trim() ?? "";
  const useProxy = Boolean(contactId && url && needsProfilePictureProxy(url));
  const useDirect = Boolean(url && !useProxy);

  useEffect(() => {
    setDirectFailed(false);
    setProxyFailed(false);
    if (!useProxy) {
      setBlobUrl(null);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const blob = await api.fetchBlob(`/contacts/${contactId}/profile-picture`);
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
      } catch {
        if (!cancelled) setProxyFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
      setBlobUrl(null);
    };
  }, [contactId, useProxy, url]);

  const initials = useMemo(() => initialsFromName(name), [name]);
  const showProxy = useProxy && blobUrl && !proxyFailed;
  const showDirect = useDirect && !directFailed;

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-200 text-[10px] font-bold uppercase text-ink-600 dark:bg-ink-700 dark:text-ink-300",
        className,
      )}
    >
      {showProxy ? (
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
