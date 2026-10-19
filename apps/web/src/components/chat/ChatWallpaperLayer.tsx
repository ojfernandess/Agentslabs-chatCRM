import clsx from "clsx";
import {
  CHAT_WALLPAPER_PATTERN_DEFAULT,
  CHAT_WALLPAPER_PATTERN_SRC,
  clampChatWallpaperOpacity,
  normalizeChatWallpaperPattern,
  type ChatWallpaperPattern,
} from "@/lib/chatWallpaper";

type ChatWallpaperLayerProps = {
  opacity: number;
  mode: "light" | "dark";
  pattern?: ChatWallpaperPattern | string | null;
  className?: string;
};

/** Camada só do padrão ilustrado. A opacidade não desce para as mensagens. */
export function ChatWallpaperLayer({ opacity, mode, pattern, className }: ChatWallpaperLayerProps) {
  const amount = clampChatWallpaperOpacity(opacity) / 100;
  const src = CHAT_WALLPAPER_PATTERN_SRC[normalizeChatWallpaperPattern(pattern ?? CHAT_WALLPAPER_PATTERN_DEFAULT)];
  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none absolute inset-0 bg-repeat bg-[length:280px_auto] sm:bg-[length:420px_auto]",
        className,
      )}
      style={{
        backgroundImage: `url(${src})`,
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
