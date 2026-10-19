export const CHAT_WALLPAPER_OPACITY_DEFAULT = 8;
export const CHAT_WALLPAPER_OPACITY_MIN = 0;
export const CHAT_WALLPAPER_OPACITY_MAX = 30;

export type ChatWallpaperSettings = {
  chatWallpaperEnabled?: boolean | null;
  chatWallpaperOpacity?: number | null;
};

export type ChatWallpaperState = {
  enabled: boolean;
  opacity: number;
};

export const CHAT_WALLPAPER_OFF: ChatWallpaperState = {
  enabled: false,
  opacity: CHAT_WALLPAPER_OPACITY_DEFAULT,
};

export function clampChatWallpaperOpacity(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return CHAT_WALLPAPER_OPACITY_DEFAULT;
  return Math.min(CHAT_WALLPAPER_OPACITY_MAX, Math.max(CHAT_WALLPAPER_OPACITY_MIN, Math.round(n)));
}

type WallpaperListener = () => void;

let appliedWallpaper: ChatWallpaperState = CHAT_WALLPAPER_OFF;
const wallpaperListeners = new Set<WallpaperListener>();

export function getAppliedChatWallpaper(): ChatWallpaperState {
  return appliedWallpaper;
}

export function subscribeAppliedChatWallpaper(listener: WallpaperListener): () => void {
  wallpaperListeners.add(listener);
  return () => {
    wallpaperListeners.delete(listener);
  };
}

export function publishAppliedChatWallpaper(next: ChatWallpaperState): void {
  if (appliedWallpaper.enabled === next.enabled && appliedWallpaper.opacity === next.opacity) return;
  appliedWallpaper = next;
  for (const listener of wallpaperListeners) listener();
}

export function chatWallpaperFromSettings(
  settings: ChatWallpaperSettings | null | undefined,
): ChatWallpaperState {
  return {
    enabled: settings?.chatWallpaperEnabled === true,
    opacity: clampChatWallpaperOpacity(settings?.chatWallpaperOpacity ?? CHAT_WALLPAPER_OPACITY_DEFAULT),
  };
}
