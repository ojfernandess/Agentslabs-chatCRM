import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";

function initialsFromName(name: string): string {
  const trimmed = name.trim();
  const digits = trimmed.replace(/\D/g, "");
  const nameDigits = trimmed.replace(/\D/g, "");
  if (digits.length >= 10 && nameDigits === digits) {
    return digits.slice(-2);
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function avatarPalette(seed: string): { from: string; to: string; text: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const palettes = [
    { from: "from-violet-400", to: "to-indigo-600", text: "text-white" },
    { from: "from-emerald-400", to: "to-teal-600", text: "text-white" },
    { from: "from-sky-400", to: "to-blue-600", text: "text-white" },
    { from: "from-amber-400", to: "to-orange-600", text: "text-white" },
    { from: "from-rose-400", to: "to-pink-600", text: "text-white" },
    { from: "from-slate-400", to: "to-slate-600", text: "text-white" },
  ];
  return palettes[h % palettes.length]!;
}

const failSessionKey = (contactId: string) => `oc_avatar_fail_${contactId}`;

type Props = {
  contactId: string;
  name: string;
  profilePictureUrl?: string | null;
  /** Quando false (ex.: após sync-avatars), não chama a API — evita 404 no console. */
  hasAvatar?: boolean;
  className?: string;
  imgClassName?: string;
  useApi?: boolean;
};

export function ContactAvatar({
  contactId,
  name,
  hasAvatar,
  className,
  imgClassName,
  useApi = true,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const palette = useMemo(() => avatarPalette(contactId || name), [contactId, name]);
  const initials = useMemo(() => initialsFromName(name), [name]);

  useEffect(() => {
    const onSynced = () => {
      if (!contactId) return;
      sessionStorage.removeItem(failSessionKey(contactId));
      setReloadToken((t) => t + 1);
    };
    window.addEventListener("openconduit:contact-avatars-synced", onSynced);
    return () => window.removeEventListener("openconduit:contact-avatars-synced", onSynced);
  }, [contactId]);

  useEffect(() => {
    if (!contactId || !useApi) return;
    if (hasAvatar === false) {
      setUnavailable(true);
      sessionStorage.setItem(failSessionKey(contactId), "1");
      return;
    }

    let cancelled = false;
    let revoked: string | null = null;
    setLoading(true);

    const hadFail = sessionStorage.getItem(failSessionKey(contactId));
    if (hadFail && reloadToken === 0) {
      setUnavailable(true);
      setLoading(false);
      return;
    }

    setUnavailable(false);

    void (async () => {
      try {
        const blob = await api.fetchBlob(`/contacts/${contactId}/profile-picture`);
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
        sessionStorage.removeItem(failSessionKey(contactId));
      } catch {
        if (!cancelled) {
          setUnavailable(true);
          sessionStorage.setItem(failSessionKey(contactId), "1");
          setBlobUrl(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
      setBlobUrl(null);
    };
  }, [contactId, useApi, reloadToken, hasAvatar]);

  const showPhoto = Boolean(blobUrl && !unavailable);

  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br shadow-inner ring-1 ring-black/5 dark:ring-white/10",
        palette.from,
        palette.to,
        palette.text,
        className,
      )}
    >
      {loading && !showPhoto ? (
        <span className="absolute inset-0 animate-pulse bg-white/20" aria-hidden />
      ) : null}
      {showPhoto ? (
        <img
          src={blobUrl!}
          alt=""
          className={clsx("relative z-[1] h-full w-full object-cover", imgClassName)}
        />
      ) : (
        <span
          className={clsx(
            "relative z-[1] flex h-full w-full items-center justify-center font-bold uppercase tracking-tight",
            className?.includes("text-lg") ? "text-sm" : "text-[11px]",
          )}
        >
          {initials}
        </span>
      )}
    </span>
  );
}
