import { useEffect, useState } from "react";
import { Download, Mail, X } from "lucide-react";
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

type Props = {
  org: OrgExportTarget;
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

export function SuperAdminOrgExportModal({ org, onClose }: Props) {
  const { t } = useI18n();
  const [format, setFormat] = useState<ExportFormat>("html");
  const [delivery, setDelivery] = useState<DeliveryMode>("download");
  const [email, setEmail] = useState(org.contactEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  const onSubmit = async () => {
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

  return bodyPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="card-surface max-h-[90vh] w-full max-w-lg overflow-auto p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("superAdmin.orgExportTitle")}</h3>
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

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
              {success}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("common.cancel")}
          </button>
          <button type="button" disabled={loading} onClick={() => void onSubmit()} className="btn-primary">
            {loading
              ? t("common.loading")
              : delivery === "download"
                ? t("superAdmin.orgExportSubmitDownload")
                : t("superAdmin.orgExportSubmitEmail")}
          </button>
        </div>
      </div>
    </div>
  );
}
