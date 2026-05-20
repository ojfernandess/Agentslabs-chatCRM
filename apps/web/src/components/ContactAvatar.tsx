import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

type Props = {
  contactId: string;
  name: string;
  /** URL directa (pode falhar no browser com CDN Facebook/WhatsApp). */
  profilePictureUrl?: string | null;
  className?: string;
  imgClassName?: string;
};

/**
 * Avatar de contacto via API autenticada (evita 403 em URLs fbcdn/whatsapp.net no &lt;img&gt;).
 */
export function ContactAvatar({ contactId, name, profilePictureUrl, className, imgClassName }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const shouldFetch = Boolean(contactId && profilePictureUrl?.trim());

  useEffect(() => {
    if (!shouldFetch) {
      setBlobUrl(null);
      setFailed(false);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    setFailed(false);

    void (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/v1/contacts/${contactId}/profile-picture`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
      setBlobUrl(null);
    };
  }, [contactId, shouldFetch, profilePictureUrl]);

  const initials = useMemo(() => initialsFromName(name), [name]);
  const showImage = blobUrl && !failed;

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-200 text-[10px] font-bold uppercase text-ink-600 dark:bg-ink-700 dark:text-ink-300",
        className,
      )}
    >
      {showImage ? (
        <img src={blobUrl} alt="" className={clsx("h-full w-full object-cover", imgClassName)} />
      ) : (
        initials
      )}
    </span>
  );
}
