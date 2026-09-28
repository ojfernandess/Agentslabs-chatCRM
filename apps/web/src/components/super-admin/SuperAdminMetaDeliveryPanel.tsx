import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminMetricCard, SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type OrgInbox = { id: string; name: string; channelType: string };
type OrgOption = { id: string; name: string; inboxes: OrgInbox[] };

type WebhookRow = {
  inboxId: string;
  inboxName: string;
  provider: string | null;
  configured: boolean;
  webhookUrl: string | null;
  receivingOk: boolean;
  lastWebhookAttemptError: string | null;
  hints: string[];
};

type DiagnosticsResponse = {
  organization: { id: string; name: string };
  webhook: {
    inboxes: WebhookRow[];
    summary: { total: number; receivingOk: number; withErrors: number; notConfigured: number };
  };
  deliveryStats: {
    last24h: { sent: number; delivered: number; read: number; failed: number; blocked: number };
    last7d: { sent: number; failed: number };
  };
};

type MessageRow = {
  messageId: string;
  direction: string;
  type: string;
  status: string;
  providerMsgId: string | null;
  providerError: string | null;
  replyToMessageId: string | null;
  bodyPreview: string | null;
  isPrivate: boolean;
  sentAt: string;
  actorName: string | null;
  ledger: {
    billingStatus: string;
    policyDecision: string | null;
    policyReason: string | null;
    failedAt: string | null;
    serviceWindowOpenAtSend: boolean | null;
  } | null;
  diagnosis: string[];
  suggestedActions: string[];
};

type ConversationInspection = {
  conversation: {
    id: string;
    status: string;
    contact: { name: string; phone: string | null; waId: string | null };
    inbox: { id: string; name: string; provider: string | null };
  };
  webhook: WebhookRow | null;
  stats: {
    totalMessages: number;
    outbound: number;
    failedOutbound: number;
    blockedLedger: number;
  };
  sessionWindow: {
    open: boolean;
    lastInboundAt: string | null;
    hoursSinceLastInbound: number | null;
  };
  messages: MessageRow[];
};

function parseOrganizations(raw: unknown): OrgOption[] {
  const list =
    typeof raw === "object" && raw !== null && "organizations" in raw && Array.isArray((raw as { organizations: unknown }).organizations)
      ? (raw as { organizations: unknown[] }).organizations
      : Array.isArray(raw)
        ? raw
        : [];

  return list
    .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null && "id" in o && "name" in o)
    .map((o) => ({
      id: String(o.id),
      name: String(o.name),
      inboxes: Array.isArray(o.inboxes)
        ? o.inboxes
            .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null && "id" in i)
            .map((i) => ({
              id: String(i.id),
              name: String(i.name ?? ""),
              channelType: String(i.channelType ?? ""),
            }))
        : [],
    }));
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "pt-BR");
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "FAILED"
      ? "bg-rose-100 text-rose-800"
      : status === "SENT" || status === "DELIVERED" || status === "READ"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-slate-100 text-slate-700";
  return <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{status}</span>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      <Copy className="h-3 w-3" />
      {copied ? "✓" : label}
    </button>
  );
}

export function SuperAdminMetaDeliveryPanel() {
  const { t, locale } = useI18n();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(true);

  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [inspection, setInspection] = useState<ConversationInspection | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === organizationId) ?? null,
    [orgs, organizationId],
  );

  const whatsappInboxes = useMemo(
    () => (selectedOrg?.inboxes ?? []).filter((i) => i.channelType === "WHATSAPP"),
    [selectedOrg],
  );

  const fetchOrgs = useCallback(async () => {
    setOrgsLoading(true);
    try {
      const raw = await api.get<unknown>("/super/organizations");
      setOrgs(parseOrganizations(raw));
    } catch {
      setOrgs([]);
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  const fetchDiagnostics = useCallback(async () => {
    if (!organizationId) return;
    setDiagLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ organizationId });
      if (inboxId) params.set("inboxId", inboxId);
      const res = await api.get<DiagnosticsResponse>(`/super/meta-delivery/diagnostics?${params}`);
      setDiagnostics(res);
    } catch (e) {
      setDiagnostics(null);
      setError(e instanceof ApiError ? e.message : t("superAdmin.metaDelivery.loadError"));
    } finally {
      setDiagLoading(false);
    }
  }, [organizationId, inboxId, t]);

  const inspectConversation = useCallback(async () => {
    const trimmed = conversationId.trim();
    if (!organizationId || !trimmed) return;
    setInspectLoading(true);
    setError("");
    setInspection(null);
    try {
      const params = new URLSearchParams({
        organizationId,
        conversationId: trimmed,
        errorsOnly: String(errorsOnly),
      });
      if (inboxId) params.set("inboxId", inboxId);
      const res = await api.get<ConversationInspection>(`/super/meta-delivery/conversation?${params}`);
      setInspection(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setError(t("superAdmin.metaDelivery.conversationNotFound"));
      } else {
        setError(e instanceof ApiError ? e.message : t("superAdmin.metaDelivery.inspectError"));
      }
    } finally {
      setInspectLoading(false);
    }
  }, [organizationId, inboxId, conversationId, errorsOnly, t]);

  useEffect(() => {
    void fetchOrgs();
  }, [fetchOrgs]);

  useEffect(() => {
    if (organizationId) void fetchDiagnostics();
    else setDiagnostics(null);
  }, [organizationId, inboxId, fetchDiagnostics]);

  useEffect(() => {
    setInboxId("");
  }, [organizationId]);

  const failedMessages = inspection?.messages.filter((m) => m.status === "FAILED") ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t("superAdmin.metaDelivery.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("superAdmin.metaDelivery.subtitle")}</p>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>
      ) : null}

      <SuperAdminPanel className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t("superAdmin.selectOrg")}</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={organizationId}
              disabled={orgsLoading}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              <option value="">{orgsLoading ? t("common.loading") : "—"}</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t("superAdmin.metaDelivery.inbox")}</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={inboxId}
              disabled={!organizationId}
              onChange={(e) => setInboxId(e.target.value)}
            >
              <option value="">{t("superAdmin.metaDelivery.allInboxes")}</option>
              {whatsappInboxes.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-slate-700">{t("superAdmin.metaDelivery.conversationId")}</span>
            <div className="flex gap-2">
              <input
                type="text"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
              />
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                disabled={!organizationId || !conversationId.trim() || inspectLoading}
                onClick={() => void inspectConversation()}
              >
                {inspectLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {t("superAdmin.metaDelivery.inspect")}
              </button>
            </div>
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
          />
          {t("superAdmin.metaDelivery.errorsOnly")}
        </label>
      </SuperAdminPanel>

      {organizationId && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SuperAdminMetricCard
            label={t("superAdmin.metaDelivery.statFailed24h")}
            value={diagLoading ? "…" : String(diagnostics?.deliveryStats.last24h.failed ?? 0)}
            hint={t("superAdmin.metaDelivery.statFailed24hHint")}
          />
          <SuperAdminMetricCard
            label={t("superAdmin.metaDelivery.statBlocked24h")}
            value={diagLoading ? "…" : String(diagnostics?.deliveryStats.last24h.blocked ?? 0)}
          />
          <SuperAdminMetricCard
            label={t("superAdmin.metaDelivery.statSent24h")}
            value={diagLoading ? "…" : String(diagnostics?.deliveryStats.last24h.sent ?? 0)}
          />
          <SuperAdminMetricCard
            label={t("superAdmin.metaDelivery.statFailed7d")}
            value={diagLoading ? "…" : String(diagnostics?.deliveryStats.last7d.failed ?? 0)}
          />
        </div>
      )}

      {organizationId && diagnostics?.webhook.inboxes.length ? (
        <SuperAdminPanel className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">{t("superAdmin.metaDelivery.webhookHealth")}</h2>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
              onClick={() => void fetchDiagnostics()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("superAdmin.metaDelivery.refresh")}
            </button>
          </div>
          <div className="space-y-3">
            {diagnostics.webhook.inboxes.map((inbox) => (
              <div key={inbox.inboxId} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{inbox.inboxName}</span>
                  {inbox.receivingOk ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" />
                      {t("superAdmin.metaDelivery.receivingOk")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      <AlertCircle className="h-3 w-3" />
                      {t("superAdmin.metaDelivery.receivingIssue")}
                    </span>
                  )}
                  {!inbox.configured && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
                      {t("superAdmin.metaDelivery.notConfigured")}
                    </span>
                  )}
                </div>
                {inbox.lastWebhookAttemptError ? (
                  <p className="mt-2 text-xs text-rose-700">{inbox.lastWebhookAttemptError}</p>
                ) : null}
                {inbox.hints.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">
                    {inbox.hints.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </SuperAdminPanel>
      ) : null}

      {inspection && (
        <>
          <SuperAdminPanel className="p-5">
            <h2 className="font-semibold text-slate-900">{t("superAdmin.metaDelivery.conversationSummary")}</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">{t("superAdmin.metaDelivery.contact")}</dt>
                <dd>{inspection.conversation.contact.name} · {inspection.conversation.contact.phone ?? inspection.conversation.contact.waId ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t("superAdmin.metaDelivery.inbox")}</dt>
                <dd>{inspection.conversation.inbox.name} ({inspection.conversation.inbox.provider ?? "—"})</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t("superAdmin.metaDelivery.sessionWindow")}</dt>
                <dd>
                  {inspection.sessionWindow.open
                    ? t("superAdmin.metaDelivery.windowOpen")
                    : t("superAdmin.metaDelivery.windowClosed")}
                  {inspection.sessionWindow.hoursSinceLastInbound != null
                    ? ` · ${inspection.sessionWindow.hoursSinceLastInbound.toFixed(1)}h`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t("superAdmin.metaDelivery.failedOutbound")}</dt>
                <dd className="font-semibold text-rose-700">{inspection.stats.failedOutbound}</dd>
              </div>
            </dl>
            <div className="mt-2">
              <CopyButton value={inspection.conversation.id} label={t("superAdmin.metaDelivery.copyId")} />
            </div>
          </SuperAdminPanel>

          {failedMessages.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t("superAdmin.metaDelivery.failedHint", { count: failedMessages.length })}</p>
              </div>
            </div>
          )}

          <SuperAdminPanel className="overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="font-semibold text-slate-900">
                {t("superAdmin.metaDelivery.messages")} ({inspection.messages.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {inspection.messages.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">{t("superAdmin.metaDelivery.noMessages")}</p>
              ) : (
                inspection.messages.map((msg) => (
                  <div key={msg.messageId} className="p-5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={msg.status} />
                      <span className="text-slate-500">{msg.direction}</span>
                      <span className="text-slate-400">{formatDateTime(msg.sentAt, locale)}</span>
                      {msg.actorName ? <span className="text-slate-600">· {msg.actorName}</span> : null}
                    </div>
                    {msg.bodyPreview ? (
                      <p className="mt-2 text-slate-800">{msg.bodyPreview}</p>
                    ) : null}
                    {msg.providerMsgId ? (
                      <p className="mt-1 font-mono text-xs text-slate-500">wamid: {msg.providerMsgId}</p>
                    ) : (
                      <p className="mt-1 text-xs text-rose-600">{t("superAdmin.metaDelivery.noWamid")}</p>
                    )}
                    {msg.providerError ? (
                      <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 font-mono text-xs text-rose-800">
                        {t("superAdmin.metaDelivery.providerError")}: {msg.providerError}
                      </p>
                    ) : null}
                    {msg.ledger?.policyReason ? (
                      <p className="mt-1 text-xs text-amber-700">
                        {msg.ledger.billingStatus} · {msg.ledger.policyReason}
                      </p>
                    ) : null}
                    {msg.diagnosis.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                        {msg.diagnosis.map((d) => <li key={d}>{d}</li>)}
                      </ul>
                    )}
                    {msg.suggestedActions.length > 0 && (
                      <div className="mt-2 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-900">
                        <p className="font-medium">{t("superAdmin.metaDelivery.suggestedActions")}</p>
                        <ul className="mt-1 list-disc pl-4">
                          {msg.suggestedActions.map((a) => <li key={a}>{a}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </SuperAdminPanel>
        </>
      )}
    </div>
  );
}
