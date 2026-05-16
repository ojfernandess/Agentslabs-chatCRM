import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  buildWebsiteEmbedScript,
  type WebsiteWidgetForm,
} from "@/lib/websiteWidget";

type Props = {
  form: WebsiteWidgetForm;
  onChange: (patch: Partial<WebsiteWidgetForm>) => void;
  ingestToken?: string | null;
  showEmbed?: boolean;
};

export function WebsiteWidgetBuilder({ form, onChange, ingestToken, showEmbed = true }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"preview" | "script">("preview");
  const [copied, setCopied] = useState(false);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const color = form.widgetColor || "#2563eb";
  const embed =
    ingestToken && showEmbed ? buildWebsiteEmbedScript(baseUrl, ingestToken) : "";

  const copyEmbed = async () => {
    if (!embed) return;
    try {
      await navigator.clipboard.writeText(embed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.siteName")}</span>
            <input
              value={form.siteName}
              onChange={(e) => onChange({ siteName: e.target.value })}
              className="input-field"
              placeholder={t("inboxesPage.wizard.widget.siteNamePlaceholder")}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.fieldWebsiteUrl")}</span>
            <input
              value={form.websiteUrl}
              onChange={(e) => onChange({ websiteUrl: e.target.value })}
              className="input-field"
              placeholder="https://exemplo.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.welcomeTitle")}</span>
            <input
              value={form.welcomeTitle}
              onChange={(e) => onChange({ welcomeTitle: e.target.value })}
              className="input-field"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.welcomeMessage")}</span>
            <textarea
              value={form.welcomeMessage}
              onChange={(e) => onChange({ welcomeMessage: e.target.value })}
              className="input-field min-h-[88px]"
              maxLength={255}
            />
            <span className="mt-1 block text-right text-xs text-ink-400">
              {form.welcomeMessage.length} / 255
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.responseTime")}</span>
            <input
              value={form.responseTimeLabel}
              onChange={(e) => onChange({ responseTimeLabel: e.target.value, welcomeTagline: e.target.value })}
              className="input-field"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.fieldWidgetColor")}</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.widgetColor.startsWith("#") ? form.widgetColor : "#2563eb"}
                  onChange={(e) => onChange({ widgetColor: e.target.value })}
                  className="h-10 w-14 cursor-pointer rounded border border-ink-200"
                />
                <input
                  value={form.widgetColor}
                  onChange={(e) => onChange({ widgetColor: e.target.value })}
                  className="input-field flex-1"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.avatarUrl")}</span>
              <input
                value={form.avatarUrl}
                onChange={(e) => onChange({ avatarUrl: e.target.value })}
                className="input-field"
                placeholder="https://…"
              />
            </label>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.position")}</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={form.widgetPosition === "left"}
                  onChange={() => onChange({ widgetPosition: "left" })}
                />
                {t("inboxesPage.wizard.widget.positionLeft")}
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={form.widgetPosition === "right"}
                  onChange={() => onChange({ widgetPosition: "right" })}
                />
                {t("inboxesPage.wizard.widget.positionRight")}
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.bubbleType")}</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={form.bubbleType === "standard"}
                  onChange={() => onChange({ bubbleType: "standard" })}
                />
                {t("inboxesPage.wizard.widget.bubbleStandard")}
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  checked={form.bubbleType === "expanded"}
                  onChange={() => onChange({ bubbleType: "expanded" })}
                />
                {t("inboxesPage.wizard.widget.bubbleExpanded")}
              </label>
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.launcherTitle")}</span>
            <input
              value={form.bubbleLauncherTitle}
              onChange={(e) => onChange({ bubbleLauncherTitle: e.target.value })}
              className="input-field"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800">
            <input
              type="checkbox"
              checked={form.greetingEnabled}
              onChange={(e) => onChange({ greetingEnabled: e.target.checked })}
              className="rounded border-ink-300"
            />
            {t("inboxesPage.wizard.widget.greetingEnabled")}
          </label>
        </div>

        <div>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === "preview" ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700"}`}
            >
              {t("inboxesPage.wizard.widget.tabPreview")}
            </button>
            {showEmbed && ingestToken ? (
              <button
                type="button"
                onClick={() => setTab("script")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === "script" ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700"}`}
              >
                {t("inboxesPage.wizard.widget.tabScript")}
              </button>
            ) : null}
          </div>

          {tab === "preview" ? (
            <div className="relative rounded-xl border border-ink-200 bg-slate-100 p-6 dark:border-ink-600 dark:bg-ink-950/50">
              <div
                className={`mx-auto max-w-[320px] overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-ink-200/80 ${form.widgetPosition === "left" ? "mr-auto" : "ml-auto"}`}
              >
                <div className="px-4 py-3 text-white" style={{ background: color }}>
                  <p className="font-semibold">{form.siteName || "Site"}</p>
                  <p className="text-xs opacity-90">{form.responseTimeLabel}</p>
                </div>
                <div className="space-y-2 p-4">
                  <p className="font-semibold text-ink-900">{form.welcomeTitle}</p>
                  <p className="text-sm text-ink-600">{form.welcomeMessage}</p>
                  <button
                    type="button"
                    className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold text-white"
                    style={{ background: color }}
                  >
                    {t("inboxesPage.wizard.widget.startConversation")}
                  </button>
                </div>
                <p className="border-t border-ink-100 py-2 text-center text-[10px] text-ink-400">
                  © OpenNexo CRM
                </p>
              </div>
              <div
                className={`mt-4 flex ${form.widgetPosition === "left" ? "justify-start" : "justify-end"}`}
              >
                <span
                  className="inline-flex h-14 min-w-[3.5rem] items-center justify-center rounded-full px-4 text-sm font-semibold text-white shadow-lg"
                  style={{ background: color }}
                >
                  {form.bubbleType === "expanded" ? form.bubbleLauncherTitle : "💬"}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 dark:border-ink-600 dark:bg-ink-950/40">
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={() => void copyEmbed()} className="btn-secondary gap-1 px-2 py-1 text-xs">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {t("inboxesPage.wizard.ingestCopy")}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-800 dark:text-ink-200">
                {embed}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
