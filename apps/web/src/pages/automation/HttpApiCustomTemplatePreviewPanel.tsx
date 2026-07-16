import clsx from "clsx";
import { Eye } from "lucide-react";
import {
  buildTemplateParameterValues,
  previewWhatsappTemplateBody,
  renderHttpCustomTextPreview,
  resolveHttpCustomSample,
  type MappedSampleRow,
  type TemplateVarSlot,
} from "@/lib/httpApiCustomTemplatePreview";

type Translate = (key: string) => string;

type TemplateWithBody = {
  id: string;
  name: string;
  body?: string;
  bodyVariableCount?: number;
  metaCategory?: string | null;
};

export function HttpApiCustomTemplatePreviewPanel({
  messageType,
  body,
  template,
  templateSlots,
  mappedPreview,
  t,
}: {
  messageType: "TEXT" | "TEMPLATE";
  body: string;
  template: TemplateWithBody | null;
  templateSlots: TemplateVarSlot[];
  mappedPreview: MappedSampleRow[] | undefined;
  t: Translate;
}) {
  const sample = resolveHttpCustomSample(mappedPreview);

  const textPreview =
    messageType === "TEXT" ? renderHttpCustomTextPreview(body, sample.variables, sample.contactName) : "";

  const templateParams =
    messageType === "TEMPLATE" && template
      ? buildTemplateParameterValues(
          templateSlots,
          sample.variables,
          sample.contactName,
          template.bodyVariableCount ?? 0,
        )
      : [];

  const templatePreview =
    messageType === "TEMPLATE" && template?.body
      ? previewWhatsappTemplateBody(template.body, templateParams)
      : "";

  const previewText = messageType === "TEXT" ? textPreview : templatePreview;
  const hasTemplate = messageType === "TEMPLATE" && Boolean(template);

  return (
    <div className="rounded-xl border border-ink-200/80 bg-white/50 p-3 dark:border-ink-700/80 dark:bg-ink-900/30">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-ink-700 dark:text-ink-200">
        <Eye className="h-3.5 w-3.5 text-brand-600" />
        {t("automationPage.httpCustomTemplatePreview")}
      </div>
      <p className="mt-1 text-[10px] text-ink-500">
        {sample.isSample
          ? t("automationPage.httpCustomTemplatePreviewSample")
          : t("automationPage.httpCustomTemplatePreviewContact").replace("{name}", sample.contactName)}
      </p>

      {messageType === "TEMPLATE" && !hasTemplate ? (
        <p className="mt-3 text-xs text-ink-500">{t("automationPage.httpCustomTemplatePreviewSelect")}</p>
      ) : (
        <>
          {messageType === "TEMPLATE" && template ? (
            <p className="mt-2 text-[10px] font-medium text-ink-600 dark:text-ink-300">{template.name}</p>
          ) : null}
          <div
            className={clsx(
              "mt-3 max-w-sm rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-ink-900 shadow-sm",
              "bg-[#d9fdd3] dark:bg-emerald-900/40 dark:text-ink-100",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{previewText.trim() || "—"}</p>
          </div>
          {messageType === "TEMPLATE" && template && (template.bodyVariableCount ?? 0) > 0 ? (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                {t("automationPage.httpCustomTemplatePreviewSlots")}
              </p>
              {templateParams.map((value, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2 py-1 font-mono text-[10px] dark:bg-ink-950/60"
                >
                  <span className="text-ink-500">{`{{${idx + 1}}}`}</span>
                  <span className="truncate text-ink-800 dark:text-ink-200">{value || "—"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
