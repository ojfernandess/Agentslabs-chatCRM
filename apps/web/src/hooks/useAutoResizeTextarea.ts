import { useCallback, useLayoutEffect, type RefObject } from "react";
import {
  applyAutoResizeTextarea,
  COMPOSER_TEXTAREA_EXPANDED_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
} from "@/lib/autoResizeTextarea";

export function useAutoResizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  expanded = false,
) {
  const resize = useCallback(() => {
    applyAutoResizeTextarea(ref.current, {
      minHeightPx: COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
      maxHeightPx: expanded ? COMPOSER_TEXTAREA_EXPANDED_MAX_HEIGHT_PX : COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
    });
  }, [expanded, ref]);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return resize;
}
