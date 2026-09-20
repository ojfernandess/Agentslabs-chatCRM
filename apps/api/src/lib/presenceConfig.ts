/** Intervalo esperado entre heartbeats (frontend). */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000;

/** Tempo sem heartbeat válido antes de considerar a sessão expirada. */
export const PRESENCE_TIMEOUT_MS = 120_000;

/** Frequência do sweeper que marca sessões stale como desconectadas. */
export const PRESENCE_SWEEP_INTERVAL_MS = 30_000;

export function presenceCutoffDate(now = Date.now()): Date {
  return new Date(now - PRESENCE_TIMEOUT_MS);
}
