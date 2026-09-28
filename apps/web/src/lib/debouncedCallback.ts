/** Coalesce rapid callbacks (e.g. scope/status count refetches) into one invocation per window. */
export function createDebouncedCallback(fn: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };
}
