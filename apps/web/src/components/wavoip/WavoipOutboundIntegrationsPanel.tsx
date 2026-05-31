import { useState } from "react";
import { Loader2, Webhook } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type IntegrationTarget = {
  url: string | null;
  secret?: string | null;
  events: string[];
} | null;

type OutboundIntegrations = {
  n8n?: IntegrationTarget;
  chatwoot?: IntegrationTarget;
};

type Props = {
  deviceId: string;
  integrations: OutboundIntegrations;
  onUpdated: () => Promise<void>;
};

const EVENTS = ["CALL", "RECORD", "DEVICE"] as const;

function targetFromClient(t: IntegrationTarget | null | undefined) {
  return {
    url: t?.url ?? "",
    secret: "",
    events: t?.events?.length ? [...t.events] : [...EVENTS],
  };
}

export function WavoipOutboundIntegrationsPanel({ deviceId, integrations, onUpdated }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [n8nUrl, setN8nUrl] = useState("");
  const [n8nSecret, setN8nSecret] = useState("");
  const [n8nEvents, setN8nEvents] = useState<string[]>([...EVENTS]);

  const [chatwootUrl, setChatwootUrl] = useState("");
  const [chatwootSecret, setChatwootSecret] = useState("");
  const [chatwootEvents, setChatwootEvents] = useState<string[]>([...EVENTS]);

  const loadForm = () => {
    const n8n = targetFromClient(integrations.n8n);
    const chatwoot = targetFromClient(integrations.chatwoot);
    setN8nUrl(n8n.url);
    setN8nSecret("");
    setN8nEvents(n8n.events);
    setChatwootUrl(chatwoot.url);
    setChatwootSecret("");
    setChatwootEvents(chatwoot.events);
    setError(null);
  };

  const toggleEvent = (list: string[], setList: (v: string[]) => void, event: string) => {
    setList(list.includes(event) ? list.filter((e) => e !== event) : [...list, event]);
  };

  const serializeTarget = (url: string, secret: string, events: string[]) => {
    const trimmed = url.trim();
    if (!trimmed) return null;
    return {
      url: trimmed,
      secret: secret.trim() || null,
      events: events.length > 0 ? events : [...EVENTS],
    };
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/settings/wavoip/devices/${deviceId}`, {
        outboundIntegrations: {
          n8n: serializeTarget(n8nUrl, n8nSecret, n8nEvents),
          chatwoot: serializeTarget(chatwootUrl, chatwootSecret, chatwootEvents),
        },
      });
      setOpen(false);
      await onUpdated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wavoip.integrations.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const renderTargetFields = (
    label: string,
    url: string,
    setUrl: (v: string) => void,
    secret: string,
    setSecret: (v: string) => void,
    events: string[],
    setEvents: (v: string[]) => void,
    hasSecret: boolean,
  ) => (
    <div className="space-y-2 rounded-lg border border-slate-100 p-3 dark:border-ink-800">
      <p className="text-xs font-semibold text-slate-800 dark:text-ink-200">{label}</p>
      <label className="block text-xs">
        <span className="text-slate-600 dark:text-ink-400">{t("wavoip.integrations.url")}</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
        />
      </label>
      <label className="block text-xs">
        <span className="text-slate-600 dark:text-ink-400">{t("wavoip.integrations.secret")}</span>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={hasSecret ? "••••••••" : ""}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
        />
      </label>
      <div className="flex flex-wrap gap-3 pt-1">
        {EVENTS.map((event) => (
          <label key={event} className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={events.includes(event)}
              onChange={() => toggleEvent(events, setEvents, event)}
            />
            {event}
          </label>
        ))}
      </div>
    </div>
  );

  const configured =
    !!integrations.n8n?.url?.trim() || !!integrations.chatwoot?.url?.trim();

  return (
    <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3 dark:border-violet-900/30 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Webhook className="mt-0.5 h-4 w-4 text-violet-600" />
          <div>
            <p className="text-sm font-semibold text-violet-950 dark:text-violet-100">
              {t("wavoip.integrations.title")}
            </p>
            <p className="mt-0.5 text-xs text-violet-900/80 dark:text-violet-200/80">
              {t("wavoip.integrations.subtitle")}
            </p>
            {configured && !open && (
              <p className="mt-1 text-[11px] text-violet-800 dark:text-violet-300">
                {t("wavoip.integrations.configured")}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!open) loadForm();
            setOpen((v) => !v);
          }}
          className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100/80 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-950/40"
        >
          {open ? t("wavoip.integrations.close") : t("wavoip.integrations.configure")}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {renderTargetFields(
            t("wavoip.integrations.n8n"),
            n8nUrl,
            setN8nUrl,
            n8nSecret,
            setN8nSecret,
            n8nEvents,
            setN8nEvents,
            !!integrations.n8n?.secret,
          )}
          {renderTargetFields(
            t("wavoip.integrations.chatwoot"),
            chatwootUrl,
            setChatwootUrl,
            chatwootSecret,
            setChatwootSecret,
            chatwootEvents,
            setChatwootEvents,
            !!integrations.chatwoot?.secret,
          )}
          <p className="text-[11px] text-slate-500 dark:text-ink-500">{t("wavoip.integrations.hint")}</p>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("wavoip.integrations.save")}
          </button>
        </div>
      )}
    </div>
  );
}
