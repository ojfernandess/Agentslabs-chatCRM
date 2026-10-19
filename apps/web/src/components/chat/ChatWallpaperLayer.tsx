import clsx from "clsx";
import { clampChatWallpaperOpacity } from "@/lib/chatWallpaper";

type ChatWallpaperLayerProps = {
  opacity: number;
  mode: "light" | "dark";
  className?: string;
};

/** Camada só do padrão ilustrado. A opacidade não desce para as mensagens. */
export function ChatWallpaperLayer({ opacity, mode, className }: ChatWallpaperLayerProps) {
  const amount = clampChatWallpaperOpacity(opacity) / 100;
  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none absolute inset-0 bg-repeat bg-[length:280px_auto] sm:bg-[length:420px_auto]",
        className,
      )}
      style={{
        backgroundImage: "url(/fundo_chat.svg)",
        opacity: amount,
        /* Traço slate transparente. No claro, multiply assenta no fundo branco.
           No escuro o mesmo traço some: brightness(0) invert(1) deixa o desenho claro
           e preserva a transparência, na opacidade escolhida pelo usuário. */
        mixBlendMode: mode === "dark" ? "normal" : "multiply",
        filter: mode === "dark" ? "brightness(0) invert(1)" : undefined,
      }}
    />
  );
}
