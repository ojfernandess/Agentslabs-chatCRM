import { useI18n } from "@/i18n/I18nProvider";
import { isWhatsAppCloudApiProvider } from "@/lib/whatsappMetaConfig";

export interface WhatsAppProviderConfigFieldsProps {
  waProvider: string;
  onProviderChange: (value: string) => void;
  waDisplayPhone: string;
  onDisplayPhoneChange: (value: string) => void;
  waProviderPhoneId: string;
  onPhoneNumberIdChange: (value: string) => void;
  waWabaId: string;
  onWabaIdChange: (value: string) => void;
  waProviderApiKey: string;
  onApiKeyChange: (value: string) => void;
  waProviderBaseUrl: string;
  onBaseUrlChange: (value: string) => void;
  evolutionPlatformQrMode: boolean;
  evolutionGoPlatformMode: boolean;
  apiKeyOptionalHint?: boolean;
  /** Inbox: todos os campos Meta; configurações: só credenciais. */
  metaFieldSet?: "full" | "credentials";
  showProviderSelect?: boolean;
  waWebhookSecret?: string;
  onWebhookSecretChange?: (value: string) => void;
  webhookSecretStored?: boolean;
  onTestConnection?: () => void | Promise<void>;
  testConnectionBusy?: boolean;
  testConnectionResult?: boolean | null;
}

export function WhatsAppProviderConfigFields({
  waProvider,
  onProviderChange,
  waDisplayPhone,
  onDisplayPhoneChange,
  waProviderPhoneId,
  onPhoneNumberIdChange,
  waWabaId,
  onWabaIdChange,
  waProviderApiKey,
  onApiKeyChange,
  waProviderBaseUrl,
  onBaseUrlChange,
  evolutionPlatformQrMode,
  evolutionGoPlatformMode,
  apiKeyOptionalHint = true,
  metaFieldSet = "full",
  showProviderSelect = true,
  waWebhookSecret = "",
  onWebhookSecretChange,
  webhookSecretStored = false,
  onTestConnection,
  testConnectionBusy = false,
  testConnectionResult = null,
}: WhatsAppProviderConfigFieldsProps) {
  const { t } = useI18n();
  const cloudApi = isWhatsAppCloudApiProvider(waProvider);
  const metaFull = metaFieldSet === "full";
  const isEvolution = waProvider === "evolution" || waProvider === "evolution_go";
  const hideEvoSecrets =
    (waProvider === "evolution" && evolutionPlatformQrMode) ||
    (waProvider === "evolution_go" && evolutionGoPlatformMode);

  return (
    <div className="space-y-4">
      {showProviderSelect ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
            {t("inboxesPage.wizard.whatsappMeta.fieldProvider")}
          </label>
          <select value={waProvider} onChange={(e) => onProviderChange(e.target.value)} className="input-field">
            <option value="meta">Meta Cloud API</option>
            <option value="360dialog">360dialog</option>
            <option value="twilio">Twilio</option>
            <option value="evolution">Evolution API</option>
            <option value="evolution_go">Evolution Go</option>
          </select>
        </div>
      ) : null}

      {cloudApi ? (
        <>
          {metaFull ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                {t("inboxesPage.wizard.whatsappMeta.fieldPhoneNumber")}
              </span>
              <input
                value={waDisplayPhone}
                onChange={(e) => onDisplayPhoneChange(e.target.value)}
                className="input-field"
                placeholder={t("inboxesPage.wizard.whatsappMeta.fieldPhoneNumberPlaceholder")}
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
              {t("inboxesPage.wizard.whatsappMeta.fieldPhoneNumberId")}
            </span>
            <input
              value={waProviderPhoneId}
              onChange={(e) => onPhoneNumberIdChange(e.target.value)}
              className="input-field"
              placeholder={t("inboxesPage.wizard.whatsappMeta.fieldPhoneNumberIdPlaceholder")}
              required
            />
          </label>
          {metaFull && waProvider === "meta" ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                {t("inboxesPage.wizard.whatsappMeta.fieldWabaId")}
              </span>
              <input
                value={waWabaId}
                onChange={(e) => onWabaIdChange(e.target.value)}
                className="input-field"
                placeholder={t("inboxesPage.wizard.whatsappMeta.fieldWabaIdPlaceholder")}
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
              {t("inboxesPage.wizard.whatsappMeta.fieldApiKey")}
            </span>
            <input
              type="password"
              value={waProviderApiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              className="input-field"
              placeholder={t("inboxesPage.wizard.whatsappMeta.fieldApiKeyPlaceholder")}
              required={!apiKeyOptionalHint}
            />
            {apiKeyOptionalHint ? (
              <p className="mt-1 text-xs text-ink-500">{t("inboxesPage.wizard.whatsappMeta.apiKeyUpdateHint")}</p>
            ) : null}
          </label>
          {onWebhookSecretChange ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                {t("inboxesPage.wizard.whatsappMeta.fieldWebhookSecret")}
              </span>
              <input
                type="password"
                value={waWebhookSecret}
                onChange={(e) => onWebhookSecretChange(e.target.value)}
                className="input-field"
                placeholder={
                  webhookSecretStored
                    ? "••••••••"
                    : t("inboxesPage.wizard.whatsappMeta.fieldWebhookSecretPlaceholder")
                }
              />
              <p className="mt-1 text-xs text-ink-500">
                {t("inboxesPage.wizard.whatsappMeta.fieldWebhookSecretHint")}
              </p>
              <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
                {t("inboxesPage.wizard.whatsappMeta.fieldWebhookSecretOptionalNote")}
              </p>
            </label>
          ) : null}
        </>
      ) : null}

      {isEvolution ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
              {waProvider === "evolution_go"
                ? t("inboxesPage.wizard.whatsappMeta.fieldInstanceGo")
                : t("inboxesPage.wizard.whatsappMeta.fieldInstance")}
            </span>
            <input
              value={waProviderPhoneId}
              onChange={(e) => onPhoneNumberIdChange(e.target.value)}
              className="input-field"
              placeholder={t("inboxesPage.wizard.whatsappMeta.fieldInstancePlaceholder")}
            />
          </label>
          {!hideEvoSecrets ? (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                  {waProvider === "evolution_go"
                    ? t("inboxesPage.wizard.whatsappMeta.fieldEvoGoBaseUrl")
                    : t("inboxesPage.wizard.whatsappMeta.fieldEvoBaseUrl")}
                </span>
                <input
                  type="url"
                  value={waProviderBaseUrl}
                  onChange={(e) => onBaseUrlChange(e.target.value)}
                  className="input-field"
                  placeholder="https://"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
                  {t("inboxesPage.wizard.whatsappMeta.fieldApiKey")}
                </span>
                <input
                  type="password"
                  value={waProviderApiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  className="input-field"
                  placeholder={t("inboxesPage.wizard.whatsappMeta.fieldApiKeyPlaceholder")}
                />
                {apiKeyOptionalHint ? (
                  <p className="mt-1 text-xs text-ink-500">{t("inboxesPage.wizard.whatsappMeta.apiKeyUpdateHint")}</p>
                ) : null}
              </label>
            </>
          ) : null}
        </>
      ) : null}

      {!cloudApi && !isEvolution ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
              {t("inboxesPage.wizard.whatsappMeta.fieldPhoneNumberId")}
            </span>
            <input
              value={waProviderPhoneId}
              onChange={(e) => onPhoneNumberIdChange(e.target.value)}
              className="input-field"
              placeholder={t("inboxesPage.wizard.whatsappMeta.fieldPhoneNumberIdPlaceholder")}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">
              {t("inboxesPage.wizard.whatsappMeta.fieldApiKey")}
            </span>
            <input
              type="password"
              value={waProviderApiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              className="input-field"
              placeholder={t("inboxesPage.wizard.whatsappMeta.fieldApiKeyPlaceholder")}
            />
            {apiKeyOptionalHint ? (
              <p className="mt-1 text-xs text-ink-500">{t("inboxesPage.wizard.whatsappMeta.apiKeyUpdateHint")}</p>
            ) : null}
          </label>
        </>
      ) : null}

      {onTestConnection ? (
        <div className="pt-1">
          <button
            type="button"
            disabled={testConnectionBusy}
            onClick={() => void onTestConnection()}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            {testConnectionBusy
              ? t("inboxesPage.wizard.whatsappMeta.testConnectionTesting")
              : t("inboxesPage.wizard.whatsappMeta.testConnection")}
          </button>
          {testConnectionResult === true ? (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
              {t("inboxesPage.wizard.whatsappMeta.testConnectionOk")}
            </p>
          ) : testConnectionResult === false ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {t("inboxesPage.wizard.whatsappMeta.testConnectionFail")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
