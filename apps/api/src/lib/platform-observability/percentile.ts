/** Percentil simples (nearest-rank) sobre array já ordenado ou não. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length || p < 0 || p > 100) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function latencySummary(values: number[]): {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
} {
  if (!values.length) {
    return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}
