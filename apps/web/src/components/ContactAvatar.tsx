import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  contactProfilePictureSrc,
  needsProfilePictureProxy,
} from "@/lib/contactAvatar";

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
  "from-brand-500 to-brand-600",
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

export type ContactAvatarVariant = "default" | "list" | "detail" | "message";

type Props = {
  contactId: string;
  name: string;
  profilePictureUrl?: string | null;
  /** Foto em cache no servidor (listagem / detalhe). */
  hasAvatar?: boolean;
  /** Caminho relativo estilo Chatwoot `thumbnail`. */
  thumbnail?: string | null;
  variant?: ContactAvatarVariant;
  className?: string;
  imgClassName?: string;
  /** Força gradiente da marca (ex.: contatos de e-mail). */
  useBrandGradient?: boolean;
};

/**
 * Avatar: iniciais imediatas; foto via URL em cache (thumbnail) ou URL directa.
 * Evita fetch por contacto — o browser faz cache HTTP (padrão Chatwoot).
 */
export function ContactAvatar({
  contactId,
  name,
  profilePictureUrl,
  hasAvatar,
  thumbnail,
  variant = "default",
  className,
  imgClassName,
  useBrandGradient = false,
}: Props) {
  const [proxyFailed, setProxyFailed] = useState(false);
  const [directFailed, setDirectFailed] = useState(false);

  const url = profilePictureUrl?.trim() ?? "";
  const cachedSrc = useMemo(
    () => (hasAvatar ? contactProfilePictureSrc(contactId, thumbnail) : null),
    [contactId, hasAvatar, thumbnail],
  );
  const directSrc =
    url && !needsProfilePictureProxy(url) ? url : null;

  const showCached = Boolean(cachedSrc && !proxyFailed);
  const showDirect = Boolean(directSrc && !directFailed && !showCached);
  const showPhoto = showCached || showDirect;
  const initials = useMemo(() => initialsFromName(name), [name]);
  const gradient = useMemo(
    () => (useBrandGradient ? "from-brand-500 to-brand-600" : gradientForName(name)),
    [name, useBrandGradient],
  );

  const sizeClass =
    variant === "list"
      ? "h-[3.25rem] w-[3.25rem] text-sm"
      : variant === "detail"
        ? "h-12 w-12 text-sm"
        : variant === "message"
          ? "h-8 w-8 text-[10px]"
          : "h-10 w-10 text-[10px]";

  const lazy = variant === "list";

  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "ring-2 ring-white shadow-md dark:ring-ink-900/80",
        sizeClass,
        !showPhoto && clsx("bg-gradient-to-br text-white font-semibold tracking-wide", gradient),
        className,
      )}
      aria-hidden
    >
      {showCached ? (
        <img
          src={cachedSrc!}
          alt=""
          loading={lazy ? "lazy" : "eager"}
          decoding="async"
          referrerPolicy="no-referrer"
          className={clsx("h-full w-full object-cover", imgClassName)}
          onError={() => setProxyFailed(true)}
        />
      ) : showDirect ? (
        <img
          src={directSrc!}
          alt=""
          loading={lazy ? "lazy" : "eager"}
          decoding="async"
          referrerPolicy="no-referrer"
          className={clsx("h-full w-full object-cover", imgClassName)}
          onError={() => setDirectFailed(true)}
        />
      ) : (
        <span className="select-none drop-shadow-sm">{initials}</span>
      )}
    </span>
  );
}
