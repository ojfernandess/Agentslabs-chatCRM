/** Asset: apps/web/public/icon/facebook-svgrepo-com.svg (512×512, proporção 1:1). */
export const FACEBOOK_BRAND_ICON_SRC = "/icon/facebook-svgrepo-com.svg";

export function FacebookBrandIcon({ className }: { className?: string }) {
  return (
    <img
      src={FACEBOOK_BRAND_ICON_SRC}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
    />
  );
}
