import { useState, useEffect, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { Bot, Check, Copy, Zap } from "lucide-react";

type BotType = "WEBHOOK" | "DIALOGFLOW" | "CUSTOM";

type WebhookTestResult = {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  error?: string;
  responseBodySnippet?: string;
};

interface BotRow {
  id: string;
  name: string;
  description: string | null;
  type: BotType;
  webhookUrl: string | null;
  isActive: boolean;
  inboxTokenConfigured?: boolean;
  webhookSecretConfigured?: boolean;
  nativeManagedByOpenConduit?: boolean;
  _count?: { interactions: number };
}

type NativeDiagnosticResult = {
  status: "ok" | "warn" | "error";
  summary: string;
  reasons: string[];
};

export function BotsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [botType, setBotType] = useState<BotType>("WEBHOOK");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [isActiveNew, setIsActiveNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWebhook, setEditWebhook] = useState("");
  const [editWebhookSecret, setEditWebhookSecret] = useState("");
  const [editType, setEditType] = useState<BotType>("WEBHOOK");
  const [editActive, setEditActive] = useState(false);
  const [revealedInboxToken, setRevealedInboxToken] = useState<string | null>(null);
  const [tokenBusyId, setTokenBusyId] = useState<string | null>(null);
  const [copiedBotId, setCopiedBotId] = useState<string | null>(null);
  const [webhookTestBusy, setWebhookTestBusy] = useState<string | null>(null);
  const [webhookTestMessage, setWebhookTestMessage] = useState<string | null>(null);
  const [webhookTestTone, setWebhookTestTone] = useState<"ok" | "err" | null>(null);
  const [nativeDiagBusyId, setNativeDiagBusyId] = useState<string | null>(null);
  const [nativeDiagMessage, setNativeDiagMessage] = useState<string | null>(null);
  const [nativeDiagTone, setNativeDiagTone] = useState<"ok" | "warn" | "err" | null>(null);

  const load = async () => {
    try {
      const res = await api.get<{ data: BotRow[] }>("/bots");
      setBots(res.data);
    } catch {
      setBots([]);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [isAdmin]);

  const copyBotId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedBotId(id);
      window.setTimeout(() => setCopiedBotId(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const typeLabel = (ty: BotType) => t(`bots.types.${ty}`);

  const setTestOutcome = (tone: "ok" | "err", message: string) => {
    setWebhookTestTone(tone);
    setWebhookTestMessage(message);
  };

  const describeTestResult = (r: WebhookTestResult): { tone: "ok" | "err"; text: string } => {
    if (r.ok) {
      return {
        tone: "ok",
        text: t("bots.testWebhookOk")
          .replace("{status}", String(r.httpStatus ?? "—"))
          .replace("{ms}", String(r.latencyMs)),
      };
    }
    const detail =
      r.httpStatus != null
        ? `HTTP ${r.httpStatus}${r.responseBodySnippet ? ` — ${r.responseBodySnippet.slice(0, 220)}` : ""}`
        : (r.error ?? r.responseBodySnippet ?? "");
    return {
      tone: "err",
      text: `${t("bots.testWebhookFail")} ${t("bots.testWebhookDetail").replace("{detail}", detail)}`.trim(),
    };
  };

  const testWebhookCreate = async () => {
    const url = webhookUrl.trim();
    if (!url) {
      setTestOutcome("err", t("bots.testWebhookNeedUrl"));
      return;
    }
    setWebhookTestBusy("create");
    setWebhookTestMessage(null);
    setWebhookTestTone(null);
    try {
      const body: Record<string, string> = { webhookUrl: url };
      const sec = newWebhookSecret.trim();
      if (sec) body.webhookSecret = sec;
      const probe = name.trim();
      if (probe) body.probeName = probe;
      const r = await api.post<WebhookTestResult>("/bots/webhook-test", body);
      const { tone, text } = describeTestResult(r);
      setTestOutcome(tone, text);
    } catch (e: unknown) {
      setTestOutcome("err", e instanceof Error ? e.message : t("bots.testWebhookFail"));
    } finally {
      setWebhookTestBusy(null);
    }
  };

  const testWebhookForBot = async (
    botId: string,
    overrides?: { webhookUrl?: string; webhookSecret?: string },
  ) => {
    setWebhookTestBusy(botId);
    setWebhookTestMessage(null);
    setWebhookTestTone(null);
    try {
      const body: Record<string, string> = {};
      const u = overrides?.webhookUrl?.trim();
      if (u) body.webhookUrl = u;
      const s = overrides?.webhookSecret?.trim();
      if (s) body.webhookSecret = s;
      const r = await api.post<WebhookTestResult>(
        `/bots/${botId}/test-webhook`,
        Object.keys(body).length ? body : undefined,
      );
      const { tone, text } = describeTestResult(r);
      setTestOutcome(tone, text);
    } catch (e: unknown) {
      setTestOutcome("err", e instanceof Error ? e.message : t("bots.testWebhookFail"));
    } finally {
      setWebhookTestBusy(null);
    }
  };

  const runNativeDiagnostic = async (id: string) => {
    setNativeDiagBusyId(id);
    setNativeDiagMessage(null);
    setNativeDiagTone(null);
    try {
      const r = await api.post<NativeDiagnosticResult>(`/bots/${id}/native-diagnostic`);
      const reasons = r.reasons.length ? ` ${r.reasons.join(" | ")}` : "";
      const text = `${r.summary}${reasons}`;
      setNativeDiagMessage(text);
      setNativeDiagTone(r.status === "ok" ? "ok" : r.status === "warn" ? "warn" : "err");
    } catch (e: unknown) {
      setNativeDiagTone("err");
      setNativeDiagMessage(e instanceof Error ? e.message : "Falha ao executar diagnóstico do bot nativo.");
    } finally {
      setNativeDiagBusyId(null);
    }
  };

  const startEdit = (b: BotRow) => {
    setEditingId(b.id);
    setEditName(b.name);
    setEditWebhook(b.webhookUrl ?? "");
    setEditWebhookSecret("");
    setEditType(b.type);
    setEditActive(b.isActive);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditWebhookSecret("");
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: n,
        type: botType,
        isActive: isActiveNew,
      };
      if (webhookUrl.trim()) body.webhookUrl = webhookUrl.trim();
      if (newWebhookSecret.trim()) body.webhookSecret = newWebhookSecret.trim();
      await api.post<BotRow>("/bots", body);
      setName("");
      setWebhookUrl("");
      setNewWebhookSecret("");
      setBotType("WEBHOOK");
      setIsActiveNew(false);
      await load();
    } catch {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        type: editType,
        webhookUrl: editWebhook.trim() || null,
        isActive: editActive,
      };
      if (editWebhookSecret.trim()) body.webhookSecret = editWebhookSecret.trim();
      await api.patch(`/bots/${id}`, body);
      setEditingId(null);
      setEditWebhookSecret("");
      await load();
    } catch {
      /* ignore */
    }
  };

  const clearWebhookSecret = async (id: string) => {
    try {
      await api.patch(`/bots/${id}`, { webhookSecret: null });
      setEditWebhookSecret("");
      await load();
    } catch {
      /* ignore */
    }
  };

  const rotateInboxToken = async (id: string) => {
    setTokenBusyId(id);
    try {
      const res = await api.post<{ inboxAccessToken: string }>(`/bots/${id}/inbox-token`);
      setRevealedInboxToken(res.inboxAccessToken);
      try {
        await navigator.clipboard.writeText(res.inboxAccessToken);
      } catch {
        /* ignore */
      }
      await load();
    } catch {
      /* ignore */
    } finally {
      setTokenBusyId(null);
    }
  };

  const toggleQuickActive = async (b: BotRow) => {
    try {
      await api.patch(`/bots/${b.id}`, { isActive: !b.isActive });
      await load();
    } catch {
      /* ignore */
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-ink-600">{t("common.adminRequired")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="p-6 lg:p-8">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="mb-2 flex items-center gap-2 text-brand-600">
            <Bot className="h-6 w-6" />
            <span className="text-sm font-medium uppercase tracking-wide">{t("nav.bots")}</span>
          </div>
          <h1 className="ds-page-heading">{t("bots.title")}</h1>
          <p className="ds-page-subtitle mt-1">{t("bots.subtitle")}</p>
          <p className="mt-2 max-w-3xl text-sm text-ink-500 dark:text-ink-400">{t("bots.botIdExplain")}</p>
        </motion.header>

        <form onSubmit={handleCreate} className="ds-panel mb-8 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="ds-label">{t("bots.name")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("bots.namePlaceholder")}
              className="input w-full"
            />
          </div>
          <div>
            <label className="ds-label">{t("bots.type")}</label>
            <select value={botType} onChange={(e) => setBotType(e.target.value as BotType)} className="input w-full">
              {(["WEBHOOK", "DIALOGFLOW", "CUSTOM"] as const).map((ty) => (
                <option key={ty} value={ty}>
                  {typeLabel(ty)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ds-label">{t("bots.webhookUrl")}</label>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://…"
              className="input w-full"
              type="url"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="ds-label">{t("bots.webhookSecret")}</label>
            <input
              value={newWebhookSecret}
              onChange={(e) => setNewWebhookSecret(e.target.value)}
              placeholder="••••"
              className="input w-full"
              type="password"
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-ink-500">{t("bots.webhookSecretHint")}</p>
          </div>
          <p className="sm:col-span-2 text-xs text-ink-500">{t("bots.testWebhookHint")}</p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-ink-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={isActiveNew}
              onChange={(e) => setIsActiveNew(e.target.checked)}
              className="rounded border-ink-300 dark:border-white/20 dark:bg-white/5"
            />
            {t("bots.active")}
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" disabled={creating || !name.trim()} className="btn-primary">
              {t("bots.create")}
            </button>
            <button
              type="button"
              disabled={!!webhookTestBusy || !webhookUrl.trim()}
              onClick={() => void testWebhookCreate()}
              className="btn-secondary inline-flex items-center gap-1.5"
              title={t("bots.testWebhook")}
            >
              <Zap className="h-4 w-4" />
              {webhookTestBusy === "create" ? t("bots.testWebhookRunning") : t("bots.testWebhook")}
            </button>
          </div>
        </form>

        {revealedInboxToken ? (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
            <p className="font-medium">{t("bots.inboxTokenBanner")}</p>
            <pre className="mt-2 overflow-x-auto rounded bg-white/80 p-2 font-mono text-xs text-ink-900">{revealedInboxToken}</pre>
            <button
              type="button"
              className="btn-secondary mt-3 text-sm"
              onClick={() => setRevealedInboxToken(null)}
            >
              {t("common.close")}
            </button>
          </div>
        ) : null}

        {webhookTestMessage && webhookTestTone ? (
          <div
            className={
              webhookTestTone === "ok"
                ? "mb-6 rounded-lg border border-emerald-200 bg-emerald-50/90 p-3 text-sm text-emerald-950 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                : "mb-6 rounded-lg border border-red-200 bg-red-50/90 p-3 text-sm text-red-950 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
            }
            role="status"
          >
            {webhookTestMessage}
          </div>
        ) : null}

        {nativeDiagMessage && nativeDiagTone ? (
          <div
            className={
              nativeDiagTone === "ok"
                ? "mb-6 rounded-lg border border-emerald-200 bg-emerald-50/90 p-3 text-sm text-emerald-950 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                : nativeDiagTone === "warn"
                  ? "mb-6 rounded-lg border border-amber-200 bg-amber-50/90 p-3 text-sm text-amber-950 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
                  : "mb-6 rounded-lg border border-red-200 bg-red-50/90 p-3 text-sm text-red-950 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
            }
            role="status"
          >
            {nativeDiagMessage}
          </div>
        ) : null}

        <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-3">
          {bots.length === 0 ? (
            <p className="text-ink-500">{t("bots.empty")}</p>
          ) : (
            bots.map((b) => (
              <motion.li
                key={b.id}
                variants={staggerItem}
                className="ds-panel p-4"
              >
                {editingId === b.id ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-ink-100 bg-ink-50/80 px-3 py-2 dark:border-white/5 dark:bg-white/[0.04] sm:col-span-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-ink-600">{t("bots.botId")}</span>
                        <code className="max-w-full break-all font-mono text-[11px] text-ink-800">{b.id}</code>
                        <button
                          type="button"
                          className="inline-flex rounded p-1 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                          title={t("bots.copyBotId")}
                          aria-label={t("bots.copyBotId")}
                          onClick={() => void copyBotId(b.id)}
                        >
                          {copiedBotId === b.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="ds-label">{t("bots.name")}</label>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input w-full" />
                      </div>
                      <div>
                        <label className="ds-label">{t("bots.type")}</label>
                        <select value={editType} onChange={(e) => setEditType(e.target.value as BotType)} className="input w-full">
                          {(["WEBHOOK", "DIALOGFLOW", "CUSTOM"] as const).map((ty) => (
                            <option key={ty} value={ty}>
                              {typeLabel(ty)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="ds-label">{t("bots.webhookUrl")}</label>
                        <input
                          value={editWebhook}
                          onChange={(e) => setEditWebhook(e.target.value)}
                          className="input w-full"
                          type="url"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="ds-label">{t("bots.webhookSecret")}</label>
                        <input
                          value={editWebhookSecret}
                          onChange={(e) => setEditWebhookSecret(e.target.value)}
                          placeholder={t("bots.webhookSecretPlaceholder")}
                          className="input w-full"
                          type="password"
                          autoComplete="new-password"
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-ink-500">{t("bots.webhookSecretHint")}</p>
                          {b.webhookSecretConfigured ? (
                            <button
                              type="button"
                              className="text-xs font-medium text-brand-600 underline"
                              onClick={() => clearWebhookSecret(b.id)}
                            >
                              {t("bots.clearWebhookSecret")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-ink-500">{t("bots.testWebhookHint")}</p>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                        className="rounded border-ink-300 dark:border-white/20 dark:bg-white/5"
                      />
                      {t("bots.active")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => handleSaveEdit(b.id)} className="btn-primary text-sm">
                        {t("bots.save")}
                      </button>
                      <button
                        type="button"
                        disabled={!!webhookTestBusy}
                        onClick={() =>
                          void testWebhookForBot(b.id, {
                            webhookUrl: editWebhook.trim() || undefined,
                            webhookSecret: editWebhookSecret.trim() || undefined,
                          })
                        }
                        className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                        title={t("bots.testWebhook")}
                      >
                        <Zap className="h-3.5 w-3.5" />
                        {webhookTestBusy === b.id ? t("bots.testWebhookRunning") : t("bots.testWebhook")}
                      </button>
                      <button type="button" onClick={cancelEdit} className="btn-secondary text-sm">
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">{b.name}</p>
                      <p className="text-xs text-ink-500">
                        {typeLabel(b.type)}
                        {b._count != null ? ` · ${t("bots.interactions")}: ${b._count.interactions}` : ""}
                      </p>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-500">
                          {t("bots.botId")}
                        </span>
                        <code className="max-w-[min(100%,28rem)] truncate rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-800 sm:max-w-md">
                          {b.id}
                        </code>
                        <button
                          type="button"
                          className="inline-flex shrink-0 rounded p-1 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                          title={t("bots.copyBotId")}
                          aria-label={t("bots.copyBotId")}
                          onClick={() => void copyBotId(b.id)}
                        >
                          {copiedBotId === b.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {b.nativeManagedByOpenConduit ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
                            {t("bots.nativeBot")}
                          </span>
                        ) : null}
                        {b.inboxTokenConfigured ? (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800">
                            {t("bots.tokenConfigured")}
                          </span>
                        ) : null}
                        {b.webhookSecretConfigured ? (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800">
                            {t("bots.secretConfigured")}
                          </span>
                        ) : null}
                      </div>
                      {b.webhookUrl ? (
                        <p className="mt-1 truncate text-xs text-ink-600" title={b.webhookUrl}>
                          {b.webhookUrl}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleQuickActive(b)}
                        className={
                          b.isActive
                            ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800"
                            : "rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600"
                        }
                      >
                        {b.isActive ? t("bots.active") : t("bots.inactive")}
                      </button>
                      <button
                        type="button"
                        disabled={tokenBusyId === b.id}
                        onClick={() => rotateInboxToken(b.id)}
                        className="btn-secondary text-sm"
                        title={t("bots.inboxApi")}
                      >
                        {tokenBusyId === b.id ? t("common.loading") : t("bots.rotateInboxToken")}
                      </button>
                      {b.webhookUrl ? (
                        <button
                          type="button"
                          disabled={!!webhookTestBusy}
                          onClick={() => void testWebhookForBot(b.id)}
                          className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                          title={t("bots.testWebhook")}
                        >
                          <Zap className="h-3.5 w-3.5" />
                          {webhookTestBusy === b.id ? t("bots.testWebhookRunning") : t("bots.testWebhook")}
                        </button>
                      ) : null}
                      {b.nativeManagedByOpenConduit ? (
                        <button
                          type="button"
                          disabled={nativeDiagBusyId === b.id}
                          onClick={() => void runNativeDiagnostic(b.id)}
                          className="btn-secondary text-sm"
                          title={t("bots.nativeDiagnostic")}
                        >
                          {nativeDiagBusyId === b.id ? t("common.loading") : t("bots.nativeDiagnostic")}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => startEdit(b)} className="btn-secondary text-sm">
                        {t("common.edit")}
                      </button>
                    </div>
                  </div>
                )}
              </motion.li>
            ))
          )}
        </motion.ul>
      </div>
    </PageTransition>
  );
}
