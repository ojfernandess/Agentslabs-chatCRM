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

/** API may return `success`/`ok` while the call is still live — treat as unknown phase. */
function normalizeApiPhaseState(state: string | undefined | null): string {
  const s = (state ?? "").trim().toLowerCase();
  if (!s || s === "success" || s === "ok") return "";
  return s;
}

function liveStateRank(state: string): number {
  const s = normalizeApiPhaseState(state);
  if (!s) return 0;
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

  const liveRaw = await tryGetLiveCallStatus(input.account, input.externalCallId);
  const livePhase = normalizeApiPhaseState(liveRaw?.state);
  const live: NvoipCallStatusPayload | null = liveRaw
    ? {
        ...liveRaw,
        state: livePhase || liveRaw.state,
      }
    : null;
  const history = await nvoipFindCallInTodayHistory(
    input.account,
    input.externalCallId,
    "outbound",
  );
  const historyPayload = payloadFromHistory(history);

  let best: NvoipCallStatusPayload | null =
    livePhase && live ? { ...live, state: livePhase } : liveRaw?.state ? liveRaw : null;
  let bestRank = best?.state ? liveStateRank(String(best.state)) : 0;
  let source: ResolvedNvoipOutboundCall["source"] = "api";

  if (
    liveRaw &&
    liveRaw.talkingDurationSeconds != null &&
    Number(liveRaw.talkingDurationSeconds) > 0
  ) {
    best = { ...liveRaw, state: "established" };
    bestRank = liveStateRank("established");
    source = "api";
  }

  if (historyPayload?.state) {
    const histRank = liveStateRank(historyPayload.state);
    const histTerminal = isNvoipTerminalState(historyPayload.state);
    const storedRank = crmStatusRank(input.currentCrmStatus);
    const acceptTerminalHistory =
      histTerminal &&
      (callAgeMs >= 20_000 || storedRank >= liveStateRank("established") || bestRank >= liveStateRank("established"));
    if (
      histRank > bestRank ||
      (acceptTerminalHistory && bestRank < 100) ||
      (histRank === bestRank && histTerminal && acceptTerminalHistory)
    ) {
      best = historyPayload;
      bestRank = histRank;
      source = "history";
    }
  }

  // Click-to-call: API Nvoip frequentemente presa em calling_origin/success após atender ramal e cliente
  if (callAgeMs > 0) {
    const storedRank = crmStatusRank(input.currentCrmStatus);
    const liveState = normalizeApiPhaseState(liveRaw?.state ?? live?.state);
    const originStuck =
      !liveState ||
      liveState === "calling_origin" ||
      normalizeApiPhaseState(liveRaw?.state) === "";

    if (
      originStuck &&
      storedRank <= liveStateRank("calling_origin") &&
      bestRank <= liveStateRank("calling_origin") &&
      callAgeMs > (platformMode ? 4_000 : 8_000)
    ) {
      best = {
        state: "calling_destination",
        caller: best?.caller ?? historyPayload?.caller ?? liveRaw?.caller ?? null,
      };
      bestRank = liveStateRank("calling_destination");
      source = "inferred";
    }

    const destPhase =
      storedRank >= liveStateRank("calling_destination") ||
      bestRank >= liveStateRank("calling_destination") ||
      liveState === "calling_destination";
    const hasTalkTime =
      (historyPayload?.talkingDurationSeconds ?? 0) > 0 ||
      (liveRaw?.talkingDurationSeconds ?? 0) > 0;

    if (
      destPhase &&
      bestRank < liveStateRank("established") &&
      !isNvoipTerminalState(liveState) &&
      (liveState === "established" ||
        hasTalkTime ||
        (storedRank >= liveStateRank("calling_destination") &&
          callAgeMs > (platformMode ? 18_000 : 30_000)))
    ) {
      best = {
        state: "established",
        caller: best?.caller ?? historyPayload?.caller ?? liveRaw?.caller ?? null,
        talkingDurationSeconds:
          historyPayload?.talkingDurationSeconds ??
          liveRaw?.talkingDurationSeconds ??
          (hasTalkTime ? 1 : Math.max(1, Math.floor(callAgeMs / 1000) - 12)),
      };
      bestRank = liveStateRank("established");
      source = hasTalkTime || liveState === "established" ? source : "inferred";
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
      historyPayload?.state &&
      storedRank >= liveStateRank("calling_destination") &&
      bestRank < liveStateRank("established") &&
      (historyPayload.talkingDurationSeconds ?? 0) > 0
    ) {
      best = historyPayload;
      bestRank = liveStateRank(historyPayload.state);
      source = "history";
    }

    if (
      liveState &&
      isNvoipLiveCallState(liveState) &&
      liveStateRank(liveState) <= liveStateRank("calling_origin") &&
      callAgeMs > 10_000 &&
      historyPayload?.state &&
      liveStateRank(historyPayload.state) > liveStateRank(liveState)
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
