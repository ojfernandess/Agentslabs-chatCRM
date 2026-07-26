import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Loader2, UserCheck, X } from "lucide-react";
import { api } from "@/lib/api";

export type HitlPendingItem = {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId: string;
  botId: string;
  replyPreview: string;
  supervisorSummary: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

type Props = {
  enabled: boolean;
  t: (key: string) => string;
};

export function HitlPendingPanel({ enabled, t }: Props) {
  const [items, setItems] = useState<HitlPendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await api.get<{ data: HitlPendingItem[] }>("/automation/agent-engine/hitl/pending");
      setItems(res.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
    if (!enabled) return;
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  const resolve = async (id: string, decision: "approved" | "rejected") => {
    setActingId(id);
    try {
      await api.post(`/automation/agent-engine/hitl/${id}/resolve`, {
        decision,
        deliverOnApprove: decision === "approved",
        resumeGraph: decision === "approved",
      });
      await load();
    } finally {
      setActingId(null);
    }
  };

  if (!enabled) return null;

  return (
    <div className="mt-4 rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-2">
        <h5 className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-100">
          <UserCheck className="h-3.5 w-3.5" />
          {t("automationPage.agentEngineHitlQueue")}
        </h5>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] font-semibold text-amber-800 underline dark:text-amber-200"
        >
          {t("automationPage.agentEngineHitlRefresh")}
        </button>
      </div>
      {loading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("automationPage.agentEngineHitlLoading")}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-500">{t("automationPage.agentEngineHitlEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-amber-200/60 bg-white/90 p-2 text-xs dark:border-amber-900/30 dark:bg-ink-950/60"
            >
              <p className="font-medium text-ink-800 dark:text-ink-100">{item.supervisorSummary.slice(0, 120)}</p>
              <p className="mt-1 line-clamp-3 text-[11px] text-ink-600 dark:text-ink-300">{item.replyPreview}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={actingId === item.id}
                  onClick={() => void resolve(item.id, "approved")}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold",
                    "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50",
                  )}
                >
                  <Check className="h-3 w-3" />
                  {t("automationPage.agentEngineHitlApprove")}
                </button>
                <button
                  type="button"
                  disabled={actingId === item.id}
                  onClick={() => void resolve(item.id, "rejected")}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold",
                    "bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50",
                  )}
                >
                  <X className="h-3 w-3" />
                  {t("automationPage.agentEngineHitlReject")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
