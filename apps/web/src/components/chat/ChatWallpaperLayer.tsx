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

/** Traços claros demais para multiply/invert. A máscara pinta a cor do modo. */
const INK_MASK_PATTERNS = new Set<ChatWallpaperPattern>(["abstract", "doodle", "opennexo"]);

/** Camada só do padrão ilustrado. A opacidade não desce para as mensagens. */
export function ChatWallpaperLayer({ opacity, mode, pattern, className }: ChatWallpaperLayerProps) {
  const amount = clampChatWallpaperOpacity(opacity) / 100;
  const patternId = normalizeChatWallpaperPattern(pattern ?? CHAT_WALLPAPER_PATTERN_DEFAULT);
  const src = CHAT_WALLPAPER_PATTERN_SRC[patternId];
  const inkMask = INK_MASK_PATTERNS.has(patternId);
  const ink = mode === "dark" ? "#c5d0e0" : "#5b6b82";
  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none absolute inset-0 bg-repeat bg-[length:280px_auto] sm:bg-[length:420px_auto]",
        inkMask &&
          "[mask-repeat:repeat] [-webkit-mask-repeat:repeat] [mask-size:280px_auto] sm:[mask-size:420px_auto] [-webkit-mask-size:280px_auto] sm:[-webkit-mask-size:420px_auto]",
        className,
      )}
      style={
        inkMask
          ? {
              backgroundColor: ink,
              opacity: amount,
              maskImage: `url(${src})`,
              WebkitMaskImage: `url(${src})`,
              maskMode: "alpha",
            }
          : {
              backgroundImage: `url(${src})`,
              opacity: amount,
              /* O padrão original é traço slate transparente. No claro, multiply assenta no branco.
                 No escuro, brightness(0) invert(1) deixa o desenho claro e preserva a transparência. */
              mixBlendMode: mode === "dark" ? "normal" : "multiply",
              filter: mode === "dark" ? "brightness(0) invert(1)" : undefined,
            }
      }
    />
  );
}
