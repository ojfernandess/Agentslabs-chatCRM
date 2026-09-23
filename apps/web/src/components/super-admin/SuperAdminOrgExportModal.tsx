import { useEffect, useRef, useState } from "react";
import { Download, Mail, Upload, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { bodyPortal } from "@/lib/bodyPortal";
import { useI18n } from "@/i18n/I18nProvider";

export type OrgExportTarget = {
  id: string;
  name: string;
  slug: string;
  contactEmail?: string | null;
  _count?: { contacts: number; conversations: number };
};

type ExportFormat = "json" | "csv" | "html";
type DeliveryMode = "download" | "email";
type ModalTab = "export" | "import";

type ImportResult = {
  format: "json" | "csv";
  contacts: { created: number; updated: number; skipped: number; errors: { row: number | string; reason: string }[] };
  conversations: { created: number; updated: number; skipped: number; errors: { row: number | string; reason: string }[] };
  messages: { created: number; updated: number; skipped: number; errors: { row: number | string; reason: string }[] };
};

type Props = {
  org: OrgExportTarget;
  initialTab?: ModalTab;
  onClose: () => void;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importErrorLabel(reason: string, t: (key: string) => string): string {
  if (reason === "invalid_phone") return t("superAdmin.orgImportErrorInvalidPhone");
  if (reason === "duplicate") return t("superAdmin.orgImportErrorDuplicate");
  if (reason === "contact_not_found") return t("superAdmin.orgImportErrorContactNotFound");
  if (reason === "conversation_not_found") return t("superAdmin.orgImportErrorConversationNotFound");
  if (reason === "invalid_direction") return t("superAdmin.orgImportErrorInvalidDirection");
  if (reason === "create_failed") return t("superAdmin.orgImportErrorCreateFailed");
  return reason;
}

export function SuperAdminOrgExportModal({ org, initialTab = "export", onClose }: Props) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<ModalTab>(initialTab);

  const [format, setFormat] = useState<ExportFormat>("html");
  const [delivery, setDelivery] = useState<DeliveryMode>("download");
  const [email, setEmail] = useState(org.contactEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importContacts, setImportContacts] = useState(true);
  const [importConversations, setImportConversations] = useState(true);
  const [importMessages, setImportMessages] = useState(true);
  const [updateExistingContacts, setUpdateExistingContacts] = useState(true);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.get<{
          contactEmail: string | null;
          billingEmail: string | null;
          resolvedEmail: string | null;
        }>(`/super/organizations/${org.id}/export/contact-email`);
        if (cancelled) return;
        setEmail(data.resolvedEmail ?? data.contactEmail ?? data.billingEmail ?? "");
      } catch {
        if (!cancelled) setEmail(org.contactEmail ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org.contactEmail, org.id]);

  const onExportSubmit = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (delivery === "download") {
        const blob = await api.fetchBlob(`/super/organizations/${org.id}/export?format=${format}`);
        const stamp = new Date().toISOString().slice(0, 10);
        const safeSlug = org.slug.replace(/[^a-zA-Z0-9-]/g, "-") || "org";
        downloadBlob(blob, `${safeSlug}-export-${stamp}.${format}`);
        setSuccess(t("superAdmin.orgExportDownloadSuccess"));
        return;
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setError(t("superAdmin.orgExportEmailMissing"));
        return;
      }

      const result = await api.post<{ ok: true; sentTo: string }>(`/super/organizations/${org.id}/export/email`, {
        format,
        email: trimmedEmail,
      });
      setSuccess(t("superAdmin.orgExportEmailSuccess").replace("{email}", result.sentTo));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "contact_email_missing") {
          setError(t("superAdmin.orgExportEmailMissing"));
        } else if (err.code === "resend_not_configured") {
          setError(t("superAdmin.orgExportResendMissing"));
        } else {
          setError(err.message || t("superAdmin.orgExportFailed"));
        }
      } else {
        setError(t("superAdmin.orgExportFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const onImportSubmit = async () => {
    if (!importFile) return;
    if (!importContacts && !importConversations && !importMessages) {
      setError(t("superAdmin.orgImportScopeRequired"));
      return;
    }

    setError("");
    setSuccess("");
    setImportResult(null);
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", importFile);
      form.append("importContacts", importContacts ? "true" : "false");
      form.append("importConversations", importConversations ? "true" : "false");
      form.append("importMessages", importMessages ? "true" : "false");
      form.append("updateExistingContacts", updateExistingContacts ? "true" : "false");

      const result = await api.postMultipart<ImportResult>(`/super/organizations/${org.id}/import`, form);
      setImportResult(result);
      setSuccess(
        t("superAdmin.orgImportSuccess")
          .replace("{contactsCreated}", String(result.contacts.created))
          .replace("{contactsUpdated}", String(result.contacts.updated))
          .replace("{conversationsCreated}", String(result.conversations.created))
          .replace("{messagesCreated}", String(result.messages.created)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("superAdmin.orgImportFailed"));
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (next: ModalTab) => {
    setTab(next);
    setError("");
    setSuccess("");
    setImportResult(null);
  };

  const allImportErrors = importResult
    ? [
        ...importResult.contacts.errors.map((e) => ({ section: "contacts", ...e })),
        ...importResult.conversations.errors.map((e) => ({ section: "conversations", ...e })),
        ...importResult.messages.errors.map((e) => ({ section: "messages", ...e })),
      ].slice(0, 8)
    : [];

  return bodyPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="card-surface max-h-[90vh] w-full max-w-lg overflow-auto p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("superAdmin.orgDataTitle")}</h3>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{org.name}</p>
            {org._count ? (
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                {t("superAdmin.orgExportCounts")
                  .replace("{contacts}", String(org._count.contacts))
                  .replace("{conversations}", String(org._count.conversations))}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-ink-200 bg-ink-50/80 p-1 dark:border-ink-700 dark:bg-ink-900/40">
          <button
            type="button"
            onClick={() => switchTab("export")}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === "export"
                ? "bg-white text-brand-700 shadow-sm dark:bg-ink-950 dark:text-brand-200"
                : "text-ink-600 hover:text-ink-900 dark:text-ink-300"
            }`}
          >
            <Download className="h-4 w-4" />
            {t("superAdmin.orgDataTabExport")}
          </button>
          <button
            type="button"
            onClick={() => switchTab("import")}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === "import"
                ? "bg-white text-brand-700 shadow-sm dark:bg-ink-950 dark:text-brand-200"
                : "text-ink-600 hover:text-ink-900 dark:text-ink-300"
            }`}
          >
            <Upload className="h-4 w-4" />
            {t("superAdmin.orgDataTabImport")}
          </button>
        </div>

        {tab === "export" ? (
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-300">{t("superAdmin.orgExportFormat")}</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["html", "json", "csv"] as ExportFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={`rounded border px-3 py-2 text-sm font-medium transition ${
                      format === f
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200"
                        : "border-ink-200 text-ink-700 hover:border-ink-300 dark:border-ink-700 dark:text-ink-200"
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                {format === "html"
                  ? t("superAdmin.orgExportFormatHtmlHint")
                  : format === "json"
                    ? t("superAdmin.orgExportFormatJsonHint")
                    : t("superAdmin.orgExportFormatCsvHint")}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-300">{t("superAdmin.orgExportDelivery")}</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDelivery("download")}
                  className={`inline-flex items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-medium transition ${
                    delivery === "download"
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200"
                      : "border-ink-200 text-ink-700 hover:border-ink-300 dark:border-ink-700 dark:text-ink-200"
                  }`}
                >
                  <Download className="h-4 w-4" />
                  {t("superAdmin.orgExportDownload")}
                </button>
                <button
                  type="button"
                  onClick={() => setDelivery("email")}
                  className={`inline-flex items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-medium transition ${
                    delivery === "email"
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200"
                      : "border-ink-200 text-ink-700 hover:border-ink-300 dark:border-ink-700 dark:text-ink-200"
                  }`}
                >
                  <Mail className="h-4 w-4" />
                  {t("superAdmin.orgExportEmail")}
                </button>
              </div>
            </div>

            {delivery === "email" ? (
              <div>
                <label className="block text-xs font-medium text-ink-600 dark:text-ink-300">
                  {t("superAdmin.orgContactEmail")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field mt-1"
                  placeholder={t("superAdmin.orgContactEmailPlaceholder")}
                />
                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("superAdmin.orgExportEmailHint")}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-xs text-ink-500 dark:text-ink-400">{t("superAdmin.orgImportHint")}</p>

            <div className="space-y-2 rounded-xl border border-ink-200 bg-ink-50/60 p-3 dark:border-ink-700 dark:bg-ink-900/30">
              <label className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100">
                <input
                  type="checkbox"
                  checked={importContacts}
                  onChange={(e) => setImportContacts(e.target.checked)}
                  className="rounded border-ink-300"
                />
                {t("superAdmin.orgImportScopeContacts")}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100">
                <input
                  type="checkbox"
                  checked={importConversations}
                  onChange={(e) => setImportConversations(e.target.checked)}
                  className="rounded border-ink-300"
                />
                {t("superAdmin.orgImportScopeConversations")}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100">
                <input
                  type="checkbox"
                  checked={importMessages}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setImportMessages(checked);
                    if (checked) setImportConversations(true);
                  }}
                  className="rounded border-ink-300"
                />
                {t("superAdmin.orgImportScopeMessages")}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-800 dark:text-ink-100">
                <input
                  type="checkbox"
                  checked={updateExistingContacts}
                  onChange={(e) => setUpdateExistingContacts(e.target.checked)}
                  className="rounded border-ink-300"
                />
                {t("superAdmin.orgImportUpdateExisting")}
              </label>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                className="hidden"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] ?? null);
                  setImportResult(null);
                  setError("");
                  setSuccess("");
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary w-full justify-center"
              >
                {importFile ? importFile.name : t("superAdmin.orgImportChooseFile")}
              </button>
              <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("superAdmin.orgImportFormatHint")}</p>
            </div>

            {allImportErrors.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="font-semibold">{t("superAdmin.orgImportErrorsTitle")}</p>
                <ul className="mt-1 space-y-0.5">
                  {allImportErrors.map((item, index) => (
                    <li key={`${item.section}-${item.row}-${index}`}>
                      {item.section} #{String(item.row)}: {importErrorLabel(item.reason, t)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
            {success}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={loading || (tab === "import" && !importFile)}
            onClick={() => void (tab === "export" ? onExportSubmit() : onImportSubmit())}
            className="btn-primary"
          >
            {loading
              ? t("common.loading")
              : tab === "export"
                ? delivery === "download"
                  ? t("superAdmin.orgExportSubmitDownload")
                  : t("superAdmin.orgExportSubmitEmail")
                : t("superAdmin.orgImportSubmit")}
          </button>
        </div>
      </div>
    </div>,
  );
}
