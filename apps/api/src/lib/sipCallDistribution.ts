export type DistributionCandidate = {
  userId: string;
  offeredToday: number;
};

/** Menor quantidade de chamadas oferecidas. Empate entra no sorteio. */
export function pickLeastCallsAgent(
  candidates: DistributionCandidate[],
  random: () => number = Math.random,
): string | null {
  if (candidates.length === 0) return null;
  const min = candidates.reduce(
    (lowest, candidate) => Math.min(lowest, candidate.offeredToday),
    Number.POSITIVE_INFINITY,
  );
  const pool = candidates
    .filter((candidate) => candidate.offeredToday === min)
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index]?.userId ?? null;
}

/** Início do dia em America/Sao_Paulo, o fuso usado na conta Nvoip. */
export function saoPauloDayStart(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return new Date(`${year}-${month}-${day}T00:00:00-03:00`);
}

/** Agrupa os INVITEs da mesma ligação. O ramal local não serve de chave. */
export function distributionCallerKey(caller: string, extension = ""): string {
  const digits = caller.replace(/\D/g, "");
  const local = extension.replace(/\D/g, "");
  if (digits.length < 8 || (local.length > 0 && digits === local)) return "anonymous";
  return digits;
}
