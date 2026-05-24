import type { ReactNode } from "react";
import clsx from "clsx";
import { Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  settingsMuted,
  settingsTableHead,
  settingsTableRow,
  settingsTableWrap,
  settingsTitle,
} from "@/components/settings/settingsUi";

export interface MessageTemplateRow {
  id: string;
  name: string;
  body: string;
  templateLanguage?: string | null;
  providerTemplateId?: string | null;
  isApproved?: boolean;
  metaCategory?: string | null;
}

interface Props {
  rows: MessageTemplateRow[];
  loading?: boolean;
  emptyMessage: string;
  showSource?: boolean;
  manageable?: boolean;
  onEdit?: (row: MessageTemplateRow) => void;
  onDelete?: (row: MessageTemplateRow) => void;
}

export function MessageTemplatesTable({
  rows,
  loading = false,
  emptyMessage,
  showSource = false,
  manageable = false,
  onEdit,
  onDelete,
}: Props) {
  const { t } = useI18n();

  if (loading) {
    return <p className={settingsMuted}>{t("common.loading")}</p>;
  }
  if (rows.length === 0) {
    return <p className={settingsMuted}>{emptyMessage}</p>;
  }

  return (
    <div className={settingsTableWrap}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className={settingsTableHead}>
            <th className="px-4 py-2">{t("settings.templatesColName")}</th>
            <th className="px-4 py-2">{t("settings.templatesColLanguage")}</th>
            <th className="px-4 py-2">{t("settings.templatesColStatus")}</th>
            {showSource ? <th className="px-4 py-2">{t("settings.templatesColSource")}</th> : null}
            <th className="px-4 py-2">{t("settings.templatesColBody")}</th>
            {manageable ? <th className="px-4 py-2 text-right">{t("settings.templatesColActions")}</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-white/10">
          {rows.map((tpl) => (
            <tr key={tpl.id} className={settingsTableRow}>
              <td className="px-4 py-2.5 font-medium text-ink-900 dark:text-ink-100">
                {tpl.name}
                {tpl.metaCategory ? (
                  <span className="ml-1 text-[10px] font-normal uppercase text-ink-400">{tpl.metaCategory}</span>
                ) : null}
              </td>
              <td className="px-4 py-2.5 text-ink-600 dark:text-ink-400">{tpl.templateLanguage ?? "—"}</td>
              <td className="px-4 py-2.5">
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    !tpl.providerTemplateId?.trim() || tpl.isApproved
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
                  )}
                >
                  {!tpl.providerTemplateId?.trim()
                    ? t("settings.templatesStatusReady")
                    : tpl.isApproved
                      ? t("settings.templatesStatusApproved")
                      : t("settings.templatesStatusPending")}
                </span>
              </td>
              {showSource ? (
                <td className="px-4 py-2.5 text-ink-600 dark:text-ink-400">
                  {tpl.providerTemplateId ? t("settings.templatesSourceMeta") : t("settings.templatesSourceLocal")}
                </td>
              ) : null}
              <td className="max-w-md px-4 py-2.5 text-xs text-ink-600 dark:text-ink-400">
                <span className="line-clamp-3 whitespace-pre-wrap">{tpl.body}</span>
              </td>
              {manageable ? (
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-white/10"
                      title={t("common.edit")}
                      onClick={() => onEdit?.(tpl)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      title={t("common.delete")}
                      onClick={() => onDelete?.(tpl)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MessageTemplatesTableHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className={settingsTitle}>{title}</h3>
      {children}
    </div>
  );
}
