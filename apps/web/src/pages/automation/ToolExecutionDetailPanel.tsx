import { useMemo, useState } from "react";
import clsx from "clsx";
import { Copy, X } from "lucide-react";

export type ToolExecutionRow = {
  id: string;
  createdAt: string;
  source?: string;
  ok?: boolean;
  statusCode?: number | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  requestSummary?: unknown;
  responseSummary?: unknown;
};

type Translate = (key: string) => string;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function prettyJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

function CodeBlock({
  label,
  value,
  emptyLabel,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  onCopy: () => void;
  copyLabel: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</span>
        {value ? (
          <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-600">
            <Copy className="h-3 w-3" />
            {copyLabel}
          </button>
        ) : null}
      </div>
      {value ? (
        <pre className="max-h-64 overflow-auto rounded-lg bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-ink-100">
          {value}
        </pre>
      ) : (
        <p className="text-xs text-ink-500">{emptyLabel}</p>
      )}
    </div>
  );
}

export function ToolExecutionDetailPanel({
  execution,
  t,
  onClose,
}: {
  execution: ToolExecutionRow;
  t: Translate;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const request = asRecord(execution.requestSummary);
  const response = asRecord(execution.responseSummary);

  const requestBody = useMemo(() => {
    const raw = request?.body ?? request?.bodyPreview;
    return typeof raw === "string" ? prettyJson(raw) : "";
  }, [request]);

  const responseBody = useMemo(() => {
    const raw = response?.preview;
    return typeof raw === "string" ? prettyJson(raw) : "";
  }, [response]);

  const headersJson = useMemo(() => {
    if (request?.headers) return prettyJson(request.headers);
    if (Array.isArray(request?.headerKeys)) return prettyJson(Object.fromEntries(request.headerKeys.map((k) => [String(k), "—"])));
    return "";
  }, [request]);

  const queryJson = useMemo(() => {
    if (request?.query) return prettyJson(request.query);
    return "";
  }, [request]);

  const rawJson = useMemo(() => prettyJson(execution), [execution]);

  const handleCopyAll = async () => {
    await copyText(rawJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-950 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-ink-200 px-4 py-3 dark:border-ink-800">
          <div>
            <p className="text-xs font-semibold uppercase text-ink-500">{t("automationPage.toolsExecutionDetailTitle")}</p>
            <p className="mt-0.5 text-sm font-semibold text-ink-900 dark:text-ink-50">{formatWhen(execution.createdAt)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 font-semibold",
                  execution.ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
                )}
              >
                {execution.ok ? t("automationPage.toolsExecutionStatusOk") : t("automationPage.toolsExecutionStatusFail")}
              </span>
              {execution.statusCode != null ? (
                <span className="rounded-full bg-ink-100 px-2 py-0.5 font-mono dark:bg-ink-800">{String(execution.statusCode)}</span>
              ) : null}
              {execution.durationMs != null ? (
                <span className="text-ink-500">{String(execution.durationMs)} ms</span>
              ) : null}
              {execution.source ? (
                <span className="rounded-full bg-ink-100 px-2 py-0.5 font-mono text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                  {String(execution.source)}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {execution.errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {String(execution.errorMessage)}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-ink-200/80 p-3 dark:border-ink-700/80">
              <p className="text-[11px] font-semibold uppercase text-ink-500">{t("automationPage.toolsExecutionRequest")}</p>
              <p className="mt-2 font-mono text-sm font-bold text-brand-700 dark:text-brand-300">
                {request?.method ? String(request.method) : "—"}
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-ink-700 dark:text-ink-200">
                {request?.url ? String(request.url) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-ink-200/80 p-3 dark:border-ink-700/80">
              <p className="text-[11px] font-semibold uppercase text-ink-500">{t("automationPage.toolsExecutionMeta")}</p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">{t("automationPage.toolsExecutionBodyBytes")}</dt>
                  <dd className="font-mono">{request?.bodyBytes != null ? String(request.bodyBytes) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">{t("automationPage.toolsExecutionBodySource")}</dt>
                  <dd className="font-mono">{request?.bodySource ? String(request.bodySource) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">{t("automationPage.toolsExecutionResponseBytes")}</dt>
                  <dd className="font-mono">{response?.bytes != null ? String(response.bytes) : "—"}</dd>
                </div>
              </dl>
            </div>
          </div>

          <CodeBlock
            label={t("automationPage.toolsExecutionQuery")}
            value={queryJson}
            emptyLabel={t("automationPage.toolsExecutionEmpty")}
            onCopy={() => void copyText(queryJson)}
            copyLabel={t("automationPage.toolsExecutionCopy")}
          />

          <CodeBlock
            label={t("automationPage.toolsExecutionHeaders")}
            value={headersJson}
            emptyLabel={t("automationPage.toolsExecutionEmpty")}
            onCopy={() => void copyText(headersJson)}
            copyLabel={t("automationPage.toolsExecutionCopy")}
          />

          <CodeBlock
            label={t("automationPage.toolsExecutionBodySent")}
            value={requestBody}
            emptyLabel={t("automationPage.toolsExecutionNoBody")}
            onCopy={() => void copyText(requestBody)}
            copyLabel={t("automationPage.toolsExecutionCopy")}
          />
          {request?.bodyTruncated === true ? (
            <p className="text-[10px] text-amber-700 dark:text-amber-300">{t("automationPage.toolsExecutionBodyTruncated")}</p>
          ) : null}

          <CodeBlock
            label={t("automationPage.toolsExecutionResponse")}
            value={responseBody}
            emptyLabel={t("automationPage.toolsExecutionEmpty")}
            onCopy={() => void copyText(responseBody)}
            copyLabel={t("automationPage.toolsExecutionCopy")}
          />
          {response?.truncated === true ? (
            <p className="text-[10px] text-amber-700 dark:text-amber-300">{t("automationPage.toolsExecutionResponseTruncated")}</p>
          ) : null}

          <CodeBlock
            label={t("automationPage.toolsExecutionRawJson")}
            value={rawJson}
            emptyLabel={t("automationPage.toolsExecutionEmpty")}
            onCopy={() => void handleCopyAll()}
            copyLabel={copied ? t("automationPage.toolsExecutionCopied") : t("automationPage.toolsExecutionCopy")}
          />
        </div>
      </div>
    </div>
  );
}
