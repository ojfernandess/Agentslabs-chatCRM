import type { NvoipAccount } from "@prisma/client";
import { readNvoipPabxConfig } from "./nvoipPabxConfig.js";
import {
  isNvoipLiveCallState,
  isNvoipTerminalState,
  mapNvoipStateToCrmStatus,
  nvoipFindCallInTodayHistory,
  nvoipGetCallStatus,
  type NvoipCallStatusPayload,
} from "./nvoipClient.js";

/** Compare Nvoip callId values (exact or digits-only). */
export function nvoipSameCallId(a: string, b: string): boolean {
  const ta = a.trim();
  const tb = b.trim();
  if (ta && tb && ta === tb) return true;
  const da = ta.replace(/\D/g, "");
  const db = tb.replace(/\D/g, "");
  return Boolean(da && db && da === db);
}

const LIVE_STATE_RANK: Record<string, number> = {
  calling_origin: 10,
  dialing: 10,
  calling_destination: 20,
  ringing: 20,
  established: 30,
  active: 30,
};

function liveStateRank(state: string): number {
  const s = state.toLowerCase();
  if (isNvoipTerminalState(s)) return 100;
  return LIVE_STATE_RANK[s] ?? 0;
}

function crmStatusRank(status: string): number {
  const map: Record<string, number> = {
    DIALING: 5,
    CALLING_ORIGIN: 10,
    CALLING_DESTINATION: 20,
    RINGING: 20,
    ACTIVE: 30,
  };
  return map[status.toUpperCase()] ?? 0;
}

function payloadFromHistory(
  history: Awaited<ReturnType<typeof nvoipFindCallInTodayHistory>>,
): NvoipCallStatusPayload | null {
  if (!history?.state) return null;
  return {
    state: history.state,
    linkAudio: history.linkAudio ?? undefined,
    talkingDurationSeconds: history.talkingDurationSeconds,
    totalDurationSeconds: history.totalDurationSeconds,
    caller: history.caller,
  };
}

async function tryGetLiveCallStatus(
  account: NvoipAccount,
  callId: string,
): Promise<NvoipCallStatusPayload | null> {
  try {
    const payload = await nvoipGetCallStatus(account, callId);
    return payload.state ? payload : null;
  } catch {
    return null;
  }
}

export type ResolvedNvoipOutboundCall = {
  remote: NvoipCallStatusPayload;
  source: "api" | "history" | "inferred";
};

/**
 * Resolve outbound click-to-call state for platform webphone + CRM.
 * Nvoip flow: calling_origin (ramal) → calling_destination (cliente) → established → finished.
 * After the agent answers on webphone, GET /calls may stop updating — merge with /calls/history.
 */
export async function resolveNvoipOutboundCallRemote(input: {
  account: NvoipAccount;
  externalCallId: string;
  currentCrmStatus: string;
  startedAt: Date | null;
}): Promise<ResolvedNvoipOutboundCall | null> {
  const callAgeMs = input.startedAt ? Date.now() - input.startedAt.getTime() : 0;
  const pabx = readNvoipPabxConfig(input.account.externalConfig);
  const platformMode = pabx.mode === "platform_webphone";

  const live = await tryGetLiveCallStatus(input.account, input.externalCallId);
  const history = await nvoipFindCallInTodayHistory(
    input.account,
    input.externalCallId,
    "outbound",
  );
  const historyPayload = payloadFromHistory(history);

  let best: NvoipCallStatusPayload | null = live;
  let bestRank = live?.state ? liveStateRank(live.state) : 0;
  let source: ResolvedNvoipOutboundCall["source"] = "api";

  if (historyPayload?.state) {
    const histRank = liveStateRank(historyPayload.state);
    const histTerminal = isNvoipTerminalState(historyPayload.state);
    if (
      histRank > bestRank ||
      (histTerminal && bestRank < 100) ||
      (histRank === bestRank && histTerminal)
    ) {
      best = historyPayload;
      bestRank = histRank;
      source = "history";
    }
  }

  // Plataforma webphone: API muitas vezes fica muda após atender o ramal — avançar fase com histórico ou inferência conservadora
  if (platformMode && callAgeMs > 0) {
    const storedRank = crmStatusRank(input.currentCrmStatus);

    if (
      !live?.state &&
      storedRank <= liveStateRank("calling_origin") &&
      callAgeMs > 28_000 &&
      bestRank < liveStateRank("calling_destination")
    ) {
      best = {
        state: "calling_destination",
        caller: best?.caller ?? historyPayload?.caller ?? null,
      };
      bestRank = liveStateRank("calling_destination");
      source = "inferred";
    }

    if (
      historyPayload?.state &&
      liveStateRank(historyPayload.state) >= liveStateRank("established") &&
      bestRank < liveStateRank("established")
    ) {
      best = historyPayload;
      bestRank = liveStateRank(historyPayload.state);
      source = "history";
    }

    if (
      live?.state &&
      isNvoipLiveCallState(live.state) &&
      liveStateRank(live.state) <= liveStateRank("calling_origin") &&
      callAgeMs > 15_000 &&
      historyPayload?.state &&
      liveStateRank(historyPayload.state) > liveStateRank(live.state)
    ) {
      best = historyPayload;
      bestRank = liveStateRank(historyPayload.state);
      source = "history";
    }
  }

  if (!best?.state) return null;
  return { remote: best, source };
}

export function mapResolvedNvoipOutboundStatus(
  remote: NvoipCallStatusPayload,
  currentCrmStatus: string,
): string {
  const mapped = mapNvoipStateToCrmStatus(remote.state ?? "");
  const mappedRank = crmStatusRank(mapped);
  const currentRank = crmStatusRank(currentCrmStatus);
  if (mappedRank >= currentRank && mapped) return mapped;
  if (isNvoipTerminalState(remote.state ?? "")) return mapped || currentCrmStatus;
  return currentCrmStatus;
}
