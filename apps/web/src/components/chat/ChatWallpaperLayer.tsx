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
        /* O SVG já é traço slate com fundo transparente.
           No claro, multiply assenta o traço no fundo claro.
           No escuro, normal mantém o mesmo traço; inverter/soft-light apagava o desenho. */
        mixBlendMode: mode === "dark" ? "normal" : "multiply",
      }}
    />
  );
}
