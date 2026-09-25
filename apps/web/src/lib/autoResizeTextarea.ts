export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 76;
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 192;
export const COMPOSER_TEXTAREA_EXPANDED_MAX_HEIGHT_PX = 320;

export type AutoResizeTextareaOptions = {
  minHeightPx?: number;
  maxHeightPx?: number;
};

export function applyAutoResizeTextarea(
  el: HTMLTextAreaElement | null,
  opts?: AutoResizeTextareaOptions,
): void {
  if (!el) return;

  const minHeightPx = opts?.minHeightPx ?? COMPOSER_TEXTAREA_MIN_HEIGHT_PX;
  const maxHeightPx = opts?.maxHeightPx ?? COMPOSER_TEXTAREA_MAX_HEIGHT_PX;

  el.style.height = "auto";
  const scrollHeight = el.scrollHeight;
  const nextHeight = Math.min(Math.max(scrollHeight, minHeightPx), maxHeightPx);

  el.style.height = `${nextHeight}px`;
  el.style.overflowY = scrollHeight > maxHeightPx ? "auto" : "hidden";
}
