import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Bot, Loader2, Plus, Save, Trash2, Workflow } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import { ChatbotFlowBuilder } from "./ChatbotFlowBuilder";
import {
  defaultChatbotFlow,
  type ChatbotFlowDefinition,
  type ChatbotFlowRow,
} from "./chatbotFlowTypes";

interface BotOption {
  id: string;
  name: string;
  isActive: boolean;
}

export function AutomationChatbotHub() {
  const { t } = useI18n();
  const [flows, setFlows] = useState<ChatbotFlowRow[]>([]);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftFlow, setDraftFlow] = useState<ChatbotFlowDefinition>(defaultChatbotFlow());
  const [draftPublished, setDraftPublished] = useState(false);
  const [linkBotId, setLinkBotId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = flows.find((f) => f.id === selectedId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [flowsRes, botsRes] = await Promise.all([
        api.get<{ data: ChatbotFlowRow[] }>("/automation/chatbot-flows"),
        api.get<{ data: BotOption[] }>("/bots"),
      ]);
      setFlows(flowsRes.data ?? []);
      setBots(botsRes.data ?? []);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setDraftName(selected.name);
    setDraftDesc(selected.description ?? "");
    setDraftFlow(selected.flowDefinition ?? defaultChatbotFlow());
    setDraftPublished(selected.isPublished);
    setLinkBotId(selected.linkedBotId ?? "");
  }, [selected]);

  const createFlow = async () => {
    setSaving(true);
    try {
      const row = await api.post<ChatbotFlowRow>("/automation/chatbot-flows", {
        name: t("chatbotPage.newFlowName"),
        flowDefinition: defaultChatbotFlow(),
      });
      await load();
      setSelectedId(row.id);
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const saveFlow = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/automation/chatbot-flows/${selectedId}`, {
        name: draftName.trim(),
        description: draftDesc.trim() || null,
        isPublished: draftPublished,
        flowDefinition: draftFlow,
      });
      await load();
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteFlow = async () => {
    if (!selectedId || !confirm(t("chatbotPage.confirmDelete"))) return;
    setSaving(true);
    try {
      await api.delete(`/automation/chatbot-flows/${selectedId}`);
      setSelectedId(null);
      await load();
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const linkBot = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await api.post(`/automation/chatbot-flows/${selectedId}/link-bot`, {
        botId: linkBotId || null,
      });
      await load();
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-ink-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-xl border border-ink-200 bg-white p-3 dark:border-ink-800 dark:bg-ink-900/60">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("chatbotPage.flowList")}</h2>
          <button
            type="button"
            disabled={saving}
            onClick={() => void createFlow()}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            {t("chatbotPage.newFlow")}
          </button>
        </div>
        <ul className="space-y-1">
          {flows.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={clsx(
                  "w-full rounded-lg px-3 py-2 text-left text-xs",
                  selectedId === f.id
                    ? "bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
                    : "hover:bg-ink-50 dark:hover:bg-ink-800/50",
                )}
              >
                <span className="block truncate">{f.name}</span>
                <span className="text-[10px] text-ink-500">
                  {f.isPublished ? t("chatbotPage.published") : t("chatbotPage.draft")}
                  {f.linkedBot ? ` · ${f.linkedBot.name}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {flows.length === 0 ? (
          <p className="mt-4 text-center text-xs text-ink-500">{t("chatbotPage.empty")}</p>
        ) : null}
      </aside>

      <section className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {t("chatbotPage.loadError")}
          </div>
        ) : null}

        {!selected ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 py-20 text-center dark:border-ink-700">
            <Workflow className="h-10 w-10 text-brand-500" />
            <p className="mt-3 max-w-md text-sm text-ink-600 dark:text-ink-400">{t("chatbotPage.selectHint")}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
              <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-xs">
                <span className="font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.flowName")}</span>
                <input
                  className="rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              <label className="flex flex-[2] min-w-[240px] flex-col gap-1 text-xs">
                <span className="font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.flowDescription")}</span>
                <input
                  className="rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-ink-700 dark:text-ink-300">
                <input
                  type="checkbox"
                  checked={draftPublished}
                  onChange={(e) => setDraftPublished(e.target.checked)}
                />
                {t("chatbotPage.publish")}
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveFlow()}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("chatbotPage.save")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void deleteFlow()}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
              <p className="mb-2 text-xs text-ink-500">
                {t("chatbotPage.publicId")}: <code className="font-mono">{selected.publicId}</code>
              </p>
              <ChatbotFlowBuilder value={draftFlow} onChange={setDraftFlow} />
            </div>

            <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
                <Bot className="h-4 w-4" />
                {t("chatbotPage.linkBot")}
              </h3>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("chatbotPage.linkBotHint")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  className="min-w-[200px] flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-800"
                  value={linkBotId}
                  onChange={(e) => setLinkBotId(e.target.value)}
                >
                  <option value="">{t("chatbotPage.noBot")}</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void linkBot()}
                  className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold hover:bg-ink-50 dark:border-ink-600 dark:hover:bg-ink-800"
                >
                  {t("chatbotPage.applyLink")}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
