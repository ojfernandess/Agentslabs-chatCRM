import type { ReactNode } from "react";
import clsx from "clsx";
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
}

export function MessageTemplatesTable({ rows, loading = false, emptyMessage, showSource = false }: Props) {
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
                    tpl.isApproved
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
                  )}
                >
                  {tpl.isApproved ? t("settings.templatesStatusApproved") : t("settings.templatesStatusPending")}
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
