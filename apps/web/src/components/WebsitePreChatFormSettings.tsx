import { useI18n } from "@/i18n/I18nProvider";
import type { PreChatFormField, PreChatFormFieldType, WebsiteWidgetForm } from "@/lib/websiteWidget";

type Props = {
  form: WebsiteWidgetForm;
  onChange: (patch: Partial<WebsiteWidgetForm>) => void;
};

const FIELD_TYPES: PreChatFormFieldType[] = ["text", "email", "tel"];

export function WebsitePreChatFormSettings({ form, onChange }: Props) {
  const { t } = useI18n();

  const updateField = (index: number, patch: Partial<PreChatFormField>) => {
    onChange({
      preChatFormFields: form.preChatFormFields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-ink-200 bg-ink-50/60 p-4 dark:border-ink-600 dark:bg-ink-950/40">
      <div>
        <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
          {t("inboxesPage.wizard.widget.preChatTitle")}
        </h4>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("inboxesPage.wizard.widget.preChatIntro")}</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.preChatEnabled")}</span>
        <select
          value={form.preChatFormEnabled ? "yes" : "no"}
          onChange={(e) => onChange({ preChatFormEnabled: e.target.value === "yes" })}
          className="input-field max-w-xs"
        >
          <option value="yes">{t("inboxesPage.wizard.widget.preChatEnabledYes")}</option>
          <option value="no">{t("inboxesPage.wizard.widget.preChatEnabledNo")}</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">{t("inboxesPage.wizard.widget.preChatMessage")}</span>
        <textarea
          value={form.preChatFormMessage}
          onChange={(e) => onChange({ preChatFormMessage: e.target.value })}
          className="input-field min-h-[88px]"
          maxLength={500}
        />
      </label>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          {t("inboxesPage.wizard.widget.preChatFieldsTitle")}
        </p>
        <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-900">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-ink-200 bg-ink-50 text-ink-500 dark:border-ink-600 dark:bg-ink-950/60">
              <tr>
                <th className="px-3 py-2">{t("inboxesPage.wizard.widget.preChatColEnabled")}</th>
                <th className="px-3 py-2">{t("inboxesPage.wizard.widget.preChatColKey")}</th>
                <th className="px-3 py-2">{t("inboxesPage.wizard.widget.preChatColType")}</th>
                <th className="px-3 py-2">{t("inboxesPage.wizard.widget.preChatColRequired")}</th>
                <th className="px-3 py-2">{t("inboxesPage.wizard.widget.preChatColLabel")}</th>
                <th className="px-3 py-2">{t("inboxesPage.wizard.widget.preChatColPlaceholder")}</th>
              </tr>
            </thead>
            <tbody>
              {form.preChatFormFields.map((field, index) => (
                <tr key={field.key} className="border-b border-ink-100 last:border-0 dark:border-ink-700">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={field.enabled}
                      onChange={(e) => updateField(index, { enabled: e.target.checked })}
                      className="rounded border-ink-300"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-600">{field.key}</td>
                  <td className="px-3 py-2">
                    <select
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value as PreChatFormFieldType })}
                      className="input-field py-1 text-xs"
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(index, { required: e.target.checked })}
                      className="rounded border-ink-300"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={field.label}
                      onChange={(e) => updateField(index, { label: e.target.value })}
                      className="input-field py-1 text-xs"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={field.placeholder}
                      onChange={(e) => updateField(index, { placeholder: e.target.value })}
                      className="input-field py-1 text-xs"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function WebsitePreChatPreview({
  form,
  color,
}: {
  form: WebsiteWidgetForm;
  color: string;
}) {
  const { t } = useI18n();
  const fields = form.preChatFormFields.filter((f) => f.enabled);

  return (
    <div className="space-y-3 px-1 py-2 text-left">
      <p className="text-sm leading-relaxed text-ink-600">{form.preChatFormMessage}</p>
      {fields.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-xs font-medium text-ink-700">
            {field.label}
            {field.required ? <span className="text-red-500"> *</span> : null}
          </span>
          <input
            type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
            placeholder={field.placeholder}
            className="input-field py-2 text-sm"
            readOnly
          />
        </label>
      ))}
      <button
        type="button"
        className="mt-2 w-full rounded-[14px] py-3 text-sm font-semibold text-white"
        style={{ background: color }}
      >
        {t("inboxesPage.wizard.widget.preChatSubmit")}
      </button>
    </div>
  );
}
