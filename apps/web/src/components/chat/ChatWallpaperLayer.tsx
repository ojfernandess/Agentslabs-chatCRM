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
        mixBlendMode: mode === "dark" ? "soft-light" : "multiply",
        filter: mode === "dark" ? "invert(0.92) hue-rotate(180deg) saturate(0.4)" : undefined,
      }}
    />
  );
}
