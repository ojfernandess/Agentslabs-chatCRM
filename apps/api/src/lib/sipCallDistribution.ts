export type DistributionCandidate = {
  userId: string;
  offeredToday: number;
};

/** Registro SIP recente o bastante para receber uma oferta. */
export const SIP_REGISTER_FRESH_MS = 25_000;

/** Janela em que uma nova oferta do mesmo chamador é a mesma ligação, não outra chamada. */
export const DISTRIBUTION_CALL_WINDOW_MS = 3 * 60 * 1000;

/**
 * Atendentes empatados na menor quantidade de ofertas.
 * Não sorteia: o sorteio só acontece quando uma chamada real é distribuída.
 */
export function leastCallsPriorityPool(candidates: DistributionCandidate[]): DistributionCandidate[] {
  if (candidates.length === 0) return [];
  const min = candidates.reduce(
    (lowest, candidate) => Math.min(lowest, candidate.offeredToday),
    Number.POSITIVE_INFINITY,
  );
  return candidates
    .filter((candidate) => candidate.offeredToday === min)
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

/** Menor quantidade de chamadas oferecidas. Empate entra no sorteio. */
export function pickLeastCallsAgent(
  candidates: DistributionCandidate[],
  random: () => number = Math.random,
): string | null {
  const pool = leastCallsPriorityPool(candidates);
  if (pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index]?.userId ?? null;
}

/** Fuso do dia de balanceamento. A organização não tem fuso próprio; a conta Nvoip usa São Paulo. */
export const DISTRIBUTION_TIME_ZONE = "America/Sao_Paulo";

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

export type DistributionDayRow = {
  userId: string;
  callerDigits: string;
  sipCallId: string;
  offeredAtMs: number;
  answered: boolean;
};

export type DistributionDaySummary = {
  received: number;
  answered: number;
  byUser: Map<string, { offered: number; answered: number }>;
};

/**
 * Recebidas da organização: uma ligação, mesmo redistribuída ou repetida no mesmo INVITE.
 * Recebidas do ramal: cada oferta, inclusive tentativa redistribuída, sem repetir o mesmo INVITE.
 */
export function summarizeDistributionDay(rows: DistributionDayRow[]): DistributionDaySummary {
  const byUser = new Map<string, { offered: number; answered: number; seen: Set<string>; answeredIds: Set<string> }>();
  for (const row of rows) {
    const agent = byUser.get(row.userId) ?? {
      offered: 0,
      answered: 0,
      seen: new Set<string>(),
      answeredIds: new Set<string>(),
    };
    if (!agent.seen.has(row.sipCallId)) {
      agent.seen.add(row.sipCallId);
      agent.offered += 1;
    }
    if (row.answered && !agent.answeredIds.has(row.sipCallId)) {
      agent.answeredIds.add(row.sipCallId);
      agent.answered += 1;
    }
    byUser.set(row.userId, agent);
  }

  const sorted = [...rows].sort(
    (a, b) => a.offeredAtMs - b.offeredAtMs || a.sipCallId.localeCompare(b.sipCallId),
  );
  const calls: { callerDigits: string; sipCallIds: Set<string>; lastAt: number; answered: boolean }[] = [];
  for (const row of sorted) {
    const sameInvite = calls.find((call) => call.sipCallIds.has(row.sipCallId));
    if (sameInvite) {
      sameInvite.answered ||= row.answered;
      sameInvite.lastAt = Math.max(sameInvite.lastAt, row.offeredAtMs);
      continue;
    }
    const sameCall = [...calls]
      .reverse()
      .find(
        (call) =>
          call.callerDigits === row.callerDigits &&
          row.offeredAtMs - call.lastAt <= DISTRIBUTION_CALL_WINDOW_MS,
      );
    if (sameCall) {
      sameCall.sipCallIds.add(row.sipCallId);
      sameCall.answered ||= row.answered;
      sameCall.lastAt = row.offeredAtMs;
      continue;
    }
    calls.push({
      callerDigits: row.callerDigits,
      sipCallIds: new Set([row.sipCallId]),
      lastAt: row.offeredAtMs,
      answered: row.answered,
    });
  }

  return {
    received: calls.length,
    answered: calls.filter((call) => call.answered).length,
    byUser: new Map(
      [...byUser.entries()].map(([userId, agent]) => [
        userId,
        { offered: agent.offered, answered: agent.answered },
      ]),
    ),
  };
}

export type DistributionBoardStatus =
  | "available"
  | "ringing"
  | "in_call"
  | "paused"
  | "offline"
  | "sip_disconnected";

/** Disponibilidade de chamada: CRM, registro SIP, chamada ativa e reserva. */
export function resolveDistributionAgentStatus(input: {
  availability: "ONLINE" | "AWAY" | "OFFLINE";
  crmPresent: boolean;
  sipRegistered: boolean;
  sipBusy: boolean;
  openOffer: "OFFERED" | "ANSWERED" | null;
}): DistributionBoardStatus {
  if (input.openOffer === "OFFERED") return "ringing";
  if (input.openOffer === "ANSWERED" || input.sipBusy) return "in_call";
  if (input.availability === "AWAY") return "paused";
  if (!input.crmPresent || input.availability === "OFFLINE") return "offline";
  if (!input.sipRegistered) return "sip_disconnected";
  return "available";
}

/** Agrupa os INVITEs da mesma ligação. O ramal local não serve de chave. */
export function distributionCallerKey(caller: string, extension = ""): string {
  const digits = caller.replace(/\D/g, "");
  const local = extension.replace(/\D/g, "");
  if (digits.length < 8 || (local.length > 0 && digits === local)) return "anonymous";
  return digits;
}
