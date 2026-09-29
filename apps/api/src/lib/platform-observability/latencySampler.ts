import { latencySummary } from "./percentile.js";

export type LatencySampleKind =
  | "inbound_message"
  | "outbound_message"
  | "prisma_query"
  | "meta_webhook_http"
  | "meta_inbound_queue_lag";

type Sample = {
  at: number;
  durationMs: number;
};

const rings = new Map<LatencySampleKind, Sample[]>();
const DEFAULT_RING_SIZE = 2_000;

function ringSize(): number {
  const raw = process.env.PLATFORM_LATENCY_RING_SIZE?.trim();
  if (!raw) return DEFAULT_RING_SIZE;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(10_000, Math.max(100, Math.floor(n))) : DEFAULT_RING_SIZE;
}

function getRing(kind: LatencySampleKind): Sample[] {
  let ring = rings.get(kind);
  if (!ring) {
    ring = [];
    rings.set(kind, ring);
  }
  return ring;
}

export function recordLatencySample(kind: LatencySampleKind, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const ring = getRing(kind);
  ring.push({ at: Date.now(), durationMs: Math.round(durationMs) });
  const max = ringSize();
  while (ring.length > max) ring.shift();
}

export function getLatencySamples(kind: LatencySampleKind, windowMinutes = 60): number[] {
  const cutoff = Date.now() - windowMinutes * 60_000;
  return getRing(kind)
    .filter((s) => s.at >= cutoff)
    .map((s) => s.durationMs);
}

export function getLatencyMetrics(windowMinutes = 60): Record<
  LatencySampleKind,
  ReturnType<typeof latencySummary>
> {
  const kinds: LatencySampleKind[] = [
    "inbound_message",
    "outbound_message",
    "prisma_query",
    "meta_webhook_http",
    "meta_inbound_queue_lag",
  ];
  const out = {} as Record<LatencySampleKind, ReturnType<typeof latencySummary>>;
  for (const kind of kinds) {
    out[kind] = latencySummary(getLatencySamples(kind, windowMinutes));
  }
  return out;
}

export function resetLatencySamplerForTests(): void {
  rings.clear();
}
