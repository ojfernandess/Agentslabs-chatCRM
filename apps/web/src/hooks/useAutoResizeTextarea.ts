import { useCallback, useLayoutEffect, type RefObject } from "react";
import {
  applyAutoResizeTextarea,
  COMPOSER_TEXTAREA_EXPANDED_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  COMPOSER_TEXTAREA_MOBILE_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MOBILE_MIN_HEIGHT_PX,
} from "@/lib/autoResizeTextarea";

export function useAutoResizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  expanded = false,
  mobile = false,
) {
  const resize = useCallback(() => {
    const minHeightPx = mobile ? COMPOSER_TEXTAREA_MOBILE_MIN_HEIGHT_PX : COMPOSER_TEXTAREA_MIN_HEIGHT_PX;
    const maxHeightPx = expanded
      ? COMPOSER_TEXTAREA_EXPANDED_MAX_HEIGHT_PX
      : mobile
        ? COMPOSER_TEXTAREA_MOBILE_MAX_HEIGHT_PX
        : COMPOSER_TEXTAREA_MAX_HEIGHT_PX;
    applyAutoResizeTextarea(ref.current, {
      minHeightPx,
      maxHeightPx,
    });
  }, [expanded, mobile, ref]);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return resize;
}
