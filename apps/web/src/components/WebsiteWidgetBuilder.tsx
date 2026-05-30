import { useState } from "react";
import { Copy, Check, MessageSquare } from "lucide-react";
import clsx from "clsx";
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
            <div className="relative rounded-xl border border-ink-200 bg-gradient-to-br from-slate-100 to-slate-200/80 p-6 dark:border-ink-600 dark:from-ink-950/50 dark:to-ink-900/40">
              <div
                className={`mx-auto max-w-[340px] overflow-hidden rounded-[20px] bg-white shadow-[0_24px_64px_rgba(15,23,42,0.12)] ring-1 ring-ink-200/60 ${form.widgetPosition === "left" ? "mr-auto" : "ml-auto"}`}
              >
                <div
                  className="px-5 py-4 text-white"
                  style={{ background: `linear-gradient(145deg, ${color} 0%, ${color}dd 100%)` }}
                >
                  <div className="flex items-center gap-3">
                    {form.avatarUrl ? (
                      <img src={form.avatarUrl} alt="" className="h-11 w-11 rounded-full border-2 border-white/30 object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-lg font-bold">
                        {(form.siteName || "S").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{form.siteName || "Site"}</p>
                      <p className="text-xs opacity-90">{form.responseTimeLabel}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-center bg-gradient-to-b from-slate-50 to-white px-6 py-8 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow-md">
                    👋
                  </div>
                  <p className="font-semibold text-ink-900">{form.welcomeTitle}</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{form.welcomeMessage}</p>
                  <button
                    type="button"
                    className="mt-6 w-full rounded-[14px] py-3.5 text-sm font-semibold text-white shadow-lg"
                    style={{ background: color, boxShadow: `0 8px 24px ${color}44` }}
                  >
                    {t("inboxesPage.wizard.widget.startConversation")}
                  </button>
                </div>
                <p className="border-t border-ink-100 py-2 text-center text-[10px] text-ink-400">
                  Powered by OpenConduit
                </p>
              </div>
              <div
                className={`mt-5 flex ${form.widgetPosition === "left" ? "justify-start" : "justify-end"}`}
              >
                <span
                  className={clsx(
                    "inline-flex items-center justify-center text-sm font-semibold text-white shadow-lg",
                    form.bubbleType === "expanded"
                      ? "h-[52px] max-w-[220px] gap-2 rounded-full px-5"
                      : "h-14 w-14 rounded-full",
                  )}
                  style={{ background: color, boxShadow: `0 8px 28px ${color}55` }}
                >
                  {form.bubbleType === "expanded" ? (
                    <>
                      <MessageSquare className="h-5 w-5 shrink-0" />
                      <span className="truncate">{form.bubbleLauncherTitle}</span>
                    </>
                  ) : (
                    <MessageSquare className="h-6 w-6" />
                  )}
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
