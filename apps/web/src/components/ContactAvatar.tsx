import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

/** Paleta estável de gradientes para iniciais (sem foto). */
const INITIAL_GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-sky-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-indigo-500 to-blue-700",
  "from-cyan-500 to-sky-600",
  "from-fuchsia-500 to-violet-600",
] as const;

function gradientForName(name: string): (typeof INITIAL_GRADIENTS)[number] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % 2147483647;
  return INITIAL_GRADIENTS[h % INITIAL_GRADIENTS.length]!;
}

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

export type ContactAvatarVariant = "default" | "list" | "detail" | "message";

type Props = {
  contactId: string;
  name: string;
  profilePictureUrl?: string | null;
  hasAvatar?: boolean;
  variant?: ContactAvatarVariant;
  className?: string;
  imgClassName?: string;
};

/**
 * Avatar via API (Evolution / Evolution Go + cache). Iniciais com gradiente quando não há foto.
 */
export function ContactAvatar({
  contactId,
  name,
  profilePictureUrl,
  hasAvatar,
  variant = "default",
  className,
  imgClassName,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [apiFailed, setApiFailed] = useState(false);
  const [directFailed, setDirectFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const url = profilePictureUrl?.trim() ?? "";
  const tryApi = Boolean(contactId);
  const useDirectFallback = Boolean(url && !needsProfilePictureProxy(url) && apiFailed);

  useEffect(() => {
    if (!tryApi) {
      setBlobUrl(null);
      setApiFailed(false);
      setLoading(false);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    setApiFailed(false);
    setLoading(true);

    void (async () => {
      try {
        const blob = await api.fetchBlobOptional(`/contacts/${contactId}/profile-picture`);
        if (cancelled) return;
        if (!blob) {
          setApiFailed(true);
          return;
        }
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
      } catch {
        if (!cancelled) setApiFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
      setBlobUrl(null);
      setLoading(false);
    };
  }, [contactId, tryApi, hasAvatar, url]);

  const initials = useMemo(() => initialsFromName(name), [name]);
  const gradient = useMemo(() => gradientForName(name), [name]);
  const showApi = tryApi && blobUrl && !apiFailed;
  const showDirect = useDirectFallback && !directFailed;
  const showPhoto = showApi || showDirect;
  const showInitials = !showPhoto && !loading;

  const sizeClass =
    variant === "list"
      ? "h-[3.25rem] w-[3.25rem] text-sm"
      : variant === "detail"
        ? "h-12 w-12 text-sm"
        : variant === "message"
          ? "h-8 w-8 text-[10px]"
          : "h-10 w-10 text-[10px]";

  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "ring-2 ring-white shadow-md dark:ring-ink-900/80",
        sizeClass,
        !showPhoto && !loading && clsx("bg-gradient-to-br text-white font-semibold tracking-wide", gradient),
        loading && "bg-ink-100 dark:bg-ink-800",
        className,
      )}
      aria-hidden
    >
      {loading ? (
        <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-ink-200/80 to-ink-300/60 dark:from-ink-700 dark:to-ink-600" />
      ) : null}
      {showApi ? (
        <img
          src={blobUrl!}
          alt=""
          className={clsx("h-full w-full object-cover", imgClassName)}
        />
      ) : showDirect ? (
        <img
          src={url}
          alt=""
          className={clsx("h-full w-full object-cover", imgClassName)}
          onError={() => setDirectFailed(true)}
        />
      ) : showInitials ? (
        <span className="select-none drop-shadow-sm">{initials}</span>
      ) : null}
    </span>
  );
}
