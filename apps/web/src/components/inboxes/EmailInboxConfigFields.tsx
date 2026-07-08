import { useI18n } from "@/i18n/I18nProvider";
import {
  detectEmailProviderPreset,
  emailProviderPresetFields,
  MASKED_EMAIL_SECRET,
  type EmailProviderPreset,
  type InboxEmailConfigFields,
} from "@/lib/inboxEmailConfig";

export type EmailInboxFormState = {
  providerPreset: EmailProviderPreset;
  emailFromAddress: string;
  emailSmtpHost: string;
  emailSmtpPort: string;
  emailSmtpUser: string;
  emailSmtpPassword: string;
  emailImapHost: string;
  emailImapPort: string;
};

export function emptyEmailInboxForm(): EmailInboxFormState {
  return {
    providerPreset: "custom",
    emailFromAddress: "",
    emailSmtpHost: "",
    emailSmtpPort: "587",
    emailSmtpUser: "",
    emailSmtpPassword: "",
    emailImapHost: "",
    emailImapPort: "993",
  };
}

export function emailInboxFormFromChannelConfig(cfg: unknown): EmailInboxFormState {
  const parsed = parseEmailFormFields(cfg);
  const preset = detectEmailProviderPreset(parsed);
  return {
    providerPreset: preset,
    emailFromAddress: parsed.emailFromAddress ?? "",
    emailSmtpHost: parsed.emailSmtpHost ?? "",
    emailSmtpPort: parsed.emailSmtpPort != null ? String(parsed.emailSmtpPort) : "587",
    emailSmtpUser: parsed.emailSmtpUser ?? "",
    emailSmtpPassword:
      parsed.emailSmtpPassword === MASKED_EMAIL_SECRET ? "" : (parsed.emailSmtpPassword ?? ""),
    emailImapHost: parsed.emailImapHost ?? "",
    emailImapPort: parsed.emailImapPort != null ? String(parsed.emailImapPort) : "993",
  };
}

function parseEmailFormFields(cfg: unknown): InboxEmailConfigFields {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return {};
  const c = cfg as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const port = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v);
    if (typeof v === "string" && v.trim()) {
      const n = Number.parseInt(v.trim(), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return undefined;
  };
  return {
    emailFromAddress: str(c.emailFromAddress),
    emailSmtpHost: str(c.emailSmtpHost),
    emailSmtpPort: port(c.emailSmtpPort),
    emailSmtpUser: str(c.emailSmtpUser),
    emailSmtpPassword: str(c.emailSmtpPassword),
    emailImapHost: str(c.emailImapHost),
    emailImapPort: port(c.emailImapPort),
  };
}

export function emailInboxFormToPatch(form: EmailInboxFormState): InboxEmailConfigFields {
  const smtpPort = Number.parseInt(form.emailSmtpPort.trim(), 10);
  const imapPort = Number.parseInt(form.emailImapPort.trim(), 10);
  return {
    emailFromAddress: form.emailFromAddress.trim(),
    emailSmtpHost: form.emailSmtpHost.trim(),
    emailSmtpPort: Number.isFinite(smtpPort) && smtpPort > 0 ? smtpPort : undefined,
    emailSmtpUser: form.emailSmtpUser.trim(),
    emailSmtpPassword: form.emailSmtpPassword.trim() || undefined,
    emailImapHost: form.emailImapHost.trim() || undefined,
    emailImapPort: Number.isFinite(imapPort) && imapPort > 0 ? imapPort : undefined,
  };
}

export interface EmailInboxConfigFieldsProps {
  form: EmailInboxFormState;
  onChange: (patch: Partial<EmailInboxFormState>) => void;
  passwordStored?: boolean;
}

export function EmailInboxConfigFields({ form, onChange, passwordStored = false }: EmailInboxConfigFieldsProps) {
  const { t } = useI18n();

  const applyPreset = (preset: EmailProviderPreset) => {
    const patch: Partial<EmailInboxFormState> = { providerPreset: preset };
    if (preset !== "custom") {
      const fields = emailProviderPresetFields(preset);
      patch.emailSmtpHost = fields.emailSmtpHost ?? "";
      patch.emailSmtpPort = fields.emailSmtpPort != null ? String(fields.emailSmtpPort) : "587";
      patch.emailImapHost = fields.emailImapHost ?? "";
      patch.emailImapPort = fields.emailImapPort != null ? String(fields.emailImapPort) : "993";
    }
    onChange(patch);
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
          {t("inboxesPage.wizard.emailInbox.fieldProviderPreset")}
        </label>
        <select
          value={form.providerPreset}
          onChange={(e) => applyPreset(e.target.value as EmailProviderPreset)}
          className="input-field"
        >
          <option value="custom">{t("inboxesPage.wizard.emailInbox.presetCustom")}</option>
          <option value="gmail">{t("inboxesPage.wizard.emailInbox.presetGmail")}</option>
          <option value="outlook">{t("inboxesPage.wizard.emailInbox.presetOutlook")}</option>
        </select>
      </div>

      <div className="space-y-3 rounded-lg border border-ink-200 bg-white/70 p-4 dark:border-ink-600 dark:bg-ink-950/20">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {t("inboxesPage.wizard.emailInbox.sectionIdentity")}
        </p>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldEmailFrom")}</span>
          <input
            value={form.emailFromAddress}
            onChange={(e) => onChange({ emailFromAddress: e.target.value })}
            className="input-field"
            type="email"
            placeholder="contato@suaempresa.com.br"
            autoComplete="email"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-lg border border-ink-200 bg-white/70 p-4 dark:border-ink-600 dark:bg-ink-950/20">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {t("inboxesPage.wizard.emailInbox.sectionOutbound")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldEmailSmtpHost")}</span>
            <input
              value={form.emailSmtpHost}
              onChange={(e) => onChange({ emailSmtpHost: e.target.value, providerPreset: "custom" })}
              className="input-field"
              placeholder="smtp.gmail.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">
              {t("inboxesPage.wizard.emailInbox.fieldSmtpPort")}
            </span>
            <input
              value={form.emailSmtpPort}
              onChange={(e) => onChange({ emailSmtpPort: e.target.value, providerPreset: "custom" })}
              className="input-field"
              inputMode="numeric"
              placeholder="587"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">
              {t("inboxesPage.wizard.emailInbox.fieldSmtpUser")}
            </span>
            <input
              value={form.emailSmtpUser}
              onChange={(e) => onChange({ emailSmtpUser: e.target.value })}
              className="input-field"
              autoComplete="username"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-ink-500">
              {t("inboxesPage.wizard.emailInbox.fieldSmtpPassword")}
            </span>
            <input
              value={form.emailSmtpPassword}
              onChange={(e) => onChange({ emailSmtpPassword: e.target.value })}
              className="input-field"
              type="password"
              autoComplete="new-password"
              placeholder={passwordStored ? "••••••••" : undefined}
            />
            {passwordStored ? (
              <p className="mt-1 text-[11px] text-ink-500">{t("inboxesPage.wizard.emailInbox.passwordUpdateHint")}</p>
            ) : null}
          </label>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-dashed border-ink-200 bg-ink-50/40 p-4 dark:border-ink-600 dark:bg-ink-950/10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {t("inboxesPage.wizard.emailInbox.sectionInbound")}
          </p>
          <p className="mt-1 text-[11px] text-ink-500">{t("inboxesPage.wizard.emailInbox.imapOptionalHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-ink-500">
              {t("inboxesPage.wizard.emailInbox.fieldImapHost")}
            </span>
            <input
              value={form.emailImapHost}
              onChange={(e) => onChange({ emailImapHost: e.target.value, providerPreset: "custom" })}
              className="input-field"
              placeholder="imap.gmail.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">
              {t("inboxesPage.wizard.emailInbox.fieldImapPort")}
            </span>
            <input
              value={form.emailImapPort}
              onChange={(e) => onChange({ emailImapPort: e.target.value, providerPreset: "custom" })}
              className="input-field"
              inputMode="numeric"
              placeholder="993"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
