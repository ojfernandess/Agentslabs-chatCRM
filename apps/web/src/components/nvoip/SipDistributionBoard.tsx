import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Phone, PhoneIncoming, Users, Waypoints } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveUserAvatarUrl } from "@/lib/userAvatar";
import { USER_AVAILABILITY_CHANGED_EVENT, USER_PRESENCE_CHANGED_EVENT } from "@/lib/userAvailability";

const DISTRIBUTION_EVENT = "openconduit:sip-distribution-updated";

type BoardStatus = "available" | "ringing" | "in_call" | "paused" | "offline" | "sip_disconnected";

type BoardAgent = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  extension: string;
  status: BoardStatus;
  sipState: "registered" | "busy" | "offline" | null;
  sipUpdatedAt: string | null;
  offered: number;
  answered: number;
  priority: boolean;
};

type BoardNext = {
  kind: "none" | "one" | "tie";
  offered: number;
  agents: Array<{ userId: string; name: string; extension: string }>;
};

type Board = {
  enabled: boolean;
  generatedAt: string;
  sipFreshMs: number;
  totals: { online: number; received: number; answered: number };
  agents: BoardAgent[];
  next: BoardNext;
};

const STATUS_DOT: Record<BoardStatus, string> = {
  available: "bg-emerald-500",
  ringing: "bg-amber-500",
  in_call: "bg-orange-500",
  paused: "bg-amber-400",
  offline: "bg-ink-300 dark:bg-ink-500",
  sip_disconnected: "bg-red-500",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

function displayedStatus(agent: BoardAgent, board: Board, now: number, skewMs: number): BoardStatus {
  if (agent.status !== "available" || !agent.sipUpdatedAt) return agent.status;
  const age = now - skewMs - new Date(agent.sipUpdatedAt).getTime();
  if (age > board.sipFreshMs) return "sip_disconnected";
  return agent.status;
}

export function SipDistributionBoard() {
  const { t } = useI18n();
  const [board, setBoard] = useState<Board | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const staleRefresh = useRef("");
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;

  const load = useCallback(async () => {
    try {
      const next = await api.get<Board>("/sip/distribution/board");
      setBoard(next);
      setSkewMs(Date.now() - new Date(next.generatedAt).getTime());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!board) return;
    const stale = board.agents
      .filter((agent) => agent.status === "available" && displayedStatus(agent, board, now, skewMs) !== "available")
      .map((agent) => `${agent.userId}:${agent.sipUpdatedAt ?? ""}`)
      .join("|");
    if (!stale || stale === staleRefresh.current) return;
    staleRefresh.current = stale;
    void load();
  }, [board, load, now, skewMs]);

  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 400);
    };
    const onDistribution = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string; userId?: string; sipState?: string; sipUpdatedAt?: string }>).detail;
      if (detail?.reason === "presence" && detail.userId && detail.sipUpdatedAt) {
        const current = boardRef.current;
        const known = current?.agents.some((agent) => agent.userId === detail.userId) ?? false;
        if (!current || !known) {
          schedule();
          return;
        }
        const userId = detail.userId;
        const sipUpdatedAt = detail.sipUpdatedAt;
        const sipState = detail.sipState;
        setBoard({
          ...current,
          agents: current.agents.map((agent) =>
            agent.userId === userId
              ? {
                  ...agent,
                  sipUpdatedAt,
                  sipState:
                    sipState === "registered" || sipState === "busy" || sipState === "offline" ? sipState : agent.sipState,
                }
              : agent,
          ),
        });
        return;
      }
      schedule();
    };
    window.addEventListener(DISTRIBUTION_EVENT, onDistribution);
    window.addEventListener(USER_PRESENCE_CHANGED_EVENT, schedule);
    window.addEventListener(USER_AVAILABILITY_CHANGED_EVENT, schedule);
    window.addEventListener("openconduit:nvoip-sip-refresh", schedule);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener(DISTRIBUTION_EVENT, onDistribution);
      window.removeEventListener(USER_PRESENCE_CHANGED_EVENT, schedule);
      window.removeEventListener(USER_AVAILABILITY_CHANGED_EVENT, schedule);
      window.removeEventListener("openconduit:nvoip-sip-refresh", schedule);
    };
  }, [load]);

  const statusLabel = (status: BoardStatus) => {
    if (status === "available") return t("nvoip.sip.distributionStatusAvailable");
    if (status === "ringing") return t("nvoip.sip.distributionStatusRinging");
    if (status === "in_call") return t("nvoip.sip.distributionStatusInCall");
    if (status === "paused") return t("nvoip.sip.distributionStatusPaused");
    if (status === "sip_disconnected") return t("nvoip.sip.distributionStatusSip");
    return t("nvoip.sip.distributionStatusOffline");
  };

  const agents = board
    ? board.agents.map((agent) => ({
        ...agent,
        liveStatus: displayedStatus(agent, board, now, skewMs),
      }))
    : [];
  const liveNext = (board?.next.agents ?? []).filter((agent) => {
    const row = agents.find((item) => item.userId === agent.userId);
    return row?.liveStatus === "available";
  });

  return (
    <section
      aria-live="polite"
      className="mt-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-950/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Waypoints className="mt-0.5 h-4 w-4 text-ink-500" />
          <div>
            <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("nvoip.sip.distributionBoardTitle")}</h4>
            <p className="text-xs text-ink-500">{t("nvoip.sip.distributionBoardHint")}</p>
          </div>
        </div>
        {board?.enabled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("nvoip.sip.distributionBoardEnabled")}
          </span>
        ) : (
          <span />
        )}
      </div>

      {loading && !board ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </p>
      ) : error && !board ? (
        <p className="mt-4 text-sm text-red-600">{t("nvoip.sip.distributionBoardError")}</p>
      ) : board && agents.length === 0 ? (
        <p className="mt-4 text-sm text-ink-500">{t("nvoip.sip.distributionBoardEmpty")}</p>
      ) : board ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat icon={<Users className="h-4 w-4" />} value={board.totals.online} label={t("nvoip.sip.distributionBoardOnline")} />
            <Stat icon={<PhoneIncoming className="h-4 w-4" />} value={board.totals.received} label={t("nvoip.sip.distributionBoardReceived")} />
            <Stat icon={<Phone className="h-4 w-4" />} value={board.totals.answered} label={t("nvoip.sip.distributionBoardAnswered")} />
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <h5 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("nvoip.sip.distributionBoardAgents")}</h5>
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t("nvoip.sip.distributionBoardLive")}
            </span>
          </div>

          <div className="mt-2 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500 dark:border-ink-700">
                  <th className="py-2 pr-3 font-medium">{t("nvoip.sip.distributionBoardColAgent")}</th>
                  <th className="py-2 pr-3 font-medium">{t("nvoip.sip.distributionBoardColExtension")}</th>
                  <th className="py-2 pr-3 font-medium">{t("nvoip.sip.distributionBoardColReceived")}</th>
                  <th className="py-2 font-medium">{t("nvoip.sip.distributionBoardColAnswered")}</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.userId} className="border-b border-ink-100 last:border-0 dark:border-ink-800">
                    <td className="py-3 pr-3">
                      <AgentIdentity agent={agent} liveStatus={agent.liveStatus} status={statusLabel(agent.liveStatus)} />
                    </td>
                    <td className="py-3 pr-3 text-ink-800 dark:text-ink-100">{agent.extension}</td>
                    <td className="py-3 pr-3 text-ink-800 dark:text-ink-100">{agent.offered}</td>
                    <td className="py-3 text-ink-800 dark:text-ink-100">{agent.answered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-2 divide-y divide-ink-100 md:hidden dark:divide-ink-800">
            {agents.map((agent) => (
              <li key={agent.userId} className="flex items-center justify-between gap-3 py-3">
                <AgentIdentity agent={agent} liveStatus={agent.liveStatus} status={statusLabel(agent.liveStatus)} />
                <div className="text-right text-xs text-ink-500">
                  <p className="text-sm text-ink-800 dark:text-ink-100">{agent.extension}</p>
                  <p>
                    {agent.offered} {t("nvoip.sip.distributionBoardColReceived")} · {agent.answered}{" "}
                    {t("nvoip.sip.distributionBoardColAnswered")}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-xl border border-ink-200 p-3 dark:border-ink-700">
            <h5 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
              <Waypoints className="h-4 w-4 text-ink-500" />
              {t("nvoip.sip.distributionBoardPriority")}
            </h5>
            {liveNext.length === 0 ? (
              <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">{t("nvoip.sip.distributionBoardNone")}</p>
            ) : (
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500 dark:bg-ink-800">
                    <Users className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink-900 dark:text-ink-50">
                      {liveNext.length === 1
                        ? `${liveNext[0]?.name ?? ""} · ${liveNext[0]?.extension ?? ""}`
                        : liveNext.map((agent) => agent.name).join(` ${t("nvoip.sip.distributionBoardOr")} `)}
                    </p>
                    {liveNext.length > 1 ? (
                      <p className="mt-0.5 text-xs text-ink-500">
                        {board.next.offered} {t("nvoip.sip.distributionBoardEach")}
                      </p>
                    ) : null}
                    {liveNext.length > 1 ? (
                      <p className="mt-1 text-xs text-ink-500">{t("nvoip.sip.distributionBoardTie")}</p>
                    ) : null}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  {liveNext.length > 1
                    ? t("nvoip.sip.distributionBoardPriorityBadge")
                    : t("nvoip.sip.distributionBoardNextBadge")}
                </span>
              </div>
            )}
            <p className="mt-3 text-xs text-ink-500">{t("nvoip.sip.distributionBoardSelection")}</p>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-lg px-1 py-1">
      <div className="text-ink-400">{icon}</div>
      <p className="mt-1 text-2xl font-semibold text-ink-900 dark:text-ink-50">{value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  );
}

function AgentIdentity({ agent, liveStatus, status }: { agent: BoardAgent; liveStatus: BoardStatus; status: string }) {
  const avatar = resolveUserAvatarUrl(agent.avatarUrl);
  return (
    <div className="flex items-center gap-3">
      {avatar ? (
        <img src={avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-200">
          {initials(agent.name)}
        </span>
      )}
      <span>
        <span className="block font-medium text-ink-900 dark:text-ink-50">{agent.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[liveStatus]} ${liveStatus === "ringing" ? "animate-pulse" : ""}`} />
          {status}
        </span>
      </span>
    </div>
  );
}
