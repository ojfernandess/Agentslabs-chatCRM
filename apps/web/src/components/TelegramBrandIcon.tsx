/** Asset: apps/web/public/icon/telegram-svgrepo-com.svg (512×512, proporção 1:1). */
export const TELEGRAM_BRAND_ICON_SRC = "/icon/telegram-svgrepo-com.svg";

export function TelegramBrandIcon({ className }: { className?: string }) {
  return (
    <img
      src={TELEGRAM_BRAND_ICON_SRC}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
    />
  );
}
