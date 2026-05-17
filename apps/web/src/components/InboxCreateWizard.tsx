import { useState, useEffect, type FormEvent, type ComponentType } from "react";
import {
  MessageSquare,
  Share2,
  Mail,
  Smartphone,
  Code2,
  Send,
  Phone,
  Globe,
  Image as ImageIcon,
  PanelTop,
} from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import { InstagramBrandIcon } from "@/components/InstagramBrandIcon";
import { TelegramBrandIcon } from "@/components/TelegramBrandIcon";
import { WebsiteWidgetBuilder } from "@/components/WebsiteWidgetBuilder";
import {
  emptyWebsiteWidgetForm,
  websiteWidgetToChannelConfig,
  buildWebsiteEmbedScript,
  type WebsiteWidgetForm,
} from "@/lib/websiteWidget";
import { WhatsAppProviderConfigFields } from "@/components/inboxes/WhatsAppProviderConfigFields";
import { WhatsAppMetaWebhookCopyPanel } from "@/components/inboxes/WhatsAppMetaWebhookCopyPanel";
import {
  buildInboxWhatsappChannelConfig,
  isWhatsAppCloudApiProvider,
  summarizeWhatsappInboxes,
  type WhatsappInboxSummary,
} from "@/lib/inboxWhatsappConfig";
import { whatsappProviderLabel } from "@/lib/whatsappOrgConfig";

/** Ordem e IDs alinhados à UX do [Chatwoot](https://www.chatwoot.com/docs/user-guide/add-inbox-settings). */
export const INBOX_CHANNEL_ORDER = [
  "WEBSITE",
  "FACEBOOK",
  "WHATSAPP",
  "SMS",
  "EMAIL",
  "API",
  "TELEGRAM",
  "LINE",
  "INSTAGRAM",
  "VOICE",
] as const;

export type InboxChannelId = (typeof INBOX_CHANNEL_ORDER)[number];

const CHANNEL_ICONS: Record<InboxChannelId, ComponentType<{ className?: string }>> = {
  WEBSITE: PanelTop,
  FACEBOOK: Share2,
  WHATSAPP: WhatsAppBrandIcon,
  SMS: Smartphone,
  EMAIL: Mail,
  API: Code2,
  TELEGRAM: TelegramBrandIcon,
  LINE: Globe,
  INSTAGRAM: InstagramBrandIcon,
  VOICE: Phone,
};

type OrgUser = { id: string; name: string; email: string; role: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  orgUsers: OrgUser[];
  /** Agent bots (WEBHOOK etc.) for optional per-inbox triage; same source as /bots. */
  agentBots?: { id: string; name: string; isActive?: boolean }[];
};

type NativeCfgForm = {
  websiteUrl: string;
  widgetColor: string;
  facebookVerifyToken: string;
  instagramVerifyToken: string;
  telegramBotToken: string;
  lineChannelId: string;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  emailFromAddress: string;
  emailSmtpHost: string;
};

const emptyNativeCfg = (): NativeCfgForm => ({
  websiteUrl: "",
  widgetColor: "",
  facebookVerifyToken: "",
  instagramVerifyToken: "",
  telegramBotToken: "",
  lineChannelId: "",
  lineChannelSecret: "",
  lineChannelAccessToken: "",
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioFromNumber: "",
  emailFromAddress: "",
  emailSmtpHost: "",
});

function buildChannelConfigPayload(
  channel: InboxChannelId,
  cfg: NativeCfgForm,
): Record<string, string> | undefined {
  const o: Record<string, string> = {};
  const t = (s: string) => s.trim();
  switch (channel) {
    case "WEBSITE":
    case "API":
      if (t(cfg.websiteUrl)) o.websiteUrl = t(cfg.websiteUrl);
      if (t(cfg.widgetColor)) o.widgetColor = t(cfg.widgetColor);
      break;
    case "FACEBOOK":
      if (t(cfg.facebookVerifyToken)) o.facebookVerifyToken = t(cfg.facebookVerifyToken);
      break;
    case "INSTAGRAM":
      if (t(cfg.instagramVerifyToken)) o.instagramVerifyToken = t(cfg.instagramVerifyToken);
      break;
    case "TELEGRAM":
      if (t(cfg.telegramBotToken)) o.telegramBotToken = t(cfg.telegramBotToken);
      break;
    case "LINE":
      if (t(cfg.lineChannelId)) o.lineChannelId = t(cfg.lineChannelId);
      if (t(cfg.lineChannelSecret)) o.lineChannelSecret = t(cfg.lineChannelSecret);
      if (t(cfg.lineChannelAccessToken)) o.lineChannelAccessToken = t(cfg.lineChannelAccessToken);
      break;
    case "SMS":
    case "VOICE":
      if (t(cfg.twilioAccountSid)) o.twilioAccountSid = t(cfg.twilioAccountSid);
      if (t(cfg.twilioAuthToken)) o.twilioAuthToken = t(cfg.twilioAuthToken);
      if (t(cfg.twilioFromNumber)) o.twilioFromNumber = t(cfg.twilioFromNumber);
      break;
    case "EMAIL":
      if (t(cfg.emailFromAddress)) o.emailFromAddress = t(cfg.emailFromAddress);
      if (t(cfg.emailSmtpHost)) o.emailSmtpHost = t(cfg.emailSmtpHost);
      break;
    default:
      break;
  }
  return Object.keys(o).length ? o : undefined;
}

export function InboxCreateWizard({ open, onClose, onCreated, orgUsers, agentBots = [] }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [channel, setChannel] = useState<InboxChannelId | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [nativeCfg, setNativeCfg] = useState<NativeCfgForm>(emptyNativeCfg);
  const [websiteWidget, setWebsiteWidget] = useState<WebsiteWidgetForm>(emptyWebsiteWidgetForm());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInbox, setCreatedInbox] = useState<{
    id: string;
    ingestToken: string | null;
    channelType: string;
  } | null>(null);
  const [createAgentBotId, setCreateAgentBotId] = useState("");
  const [waProvider, setWaProvider] = useState("meta");
  const [waDisplayPhone, setWaDisplayPhone] = useState("");
  const [waProviderPhoneId, setWaProviderPhoneId] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waProviderApiKey, setWaProviderApiKey] = useState("");
  const [waWebhookSecret, setWaWebhookSecret] = useState("");
  const [waProviderBaseUrl, setWaProviderBaseUrl] = useState("");
  const [evolutionPlatformQrMode, setEvolutionPlatformQrMode] = useState(false);
  const [evolutionGoPlatformMode, setEvolutionGoPlatformMode] = useState(false);
  const [waSetupWebhookUrl, setWaSetupWebhookUrl] = useState("");
  const [waSetupVerifyToken, setWaSetupVerifyToken] = useState("");
  const [existingWhatsappInboxes, setExistingWhatsappInboxes] = useState<WhatsappInboxSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setChannel(null);
    setName("");
    setDescription("");
    setIsDefault(false);
    setSelectedAgentIds(new Set());
    setNativeCfg(emptyNativeCfg());
    setWebsiteWidget(emptyWebsiteWidgetForm());
    setCreating(false);
    setError(null);
    setCreatedInbox(null);
    setCreateAgentBotId("");
    setWaProvider("meta");
    setWaDisplayPhone("");
    setWaProviderPhoneId("");
    setWaWabaId("");
    setWaProviderApiKey("");
    setWaWebhookSecret("");
    setWaProviderBaseUrl("");
    setEvolutionPlatformQrMode(false);
    setEvolutionGoPlatformMode(false);
    setWaSetupWebhookUrl("");
    setWaSetupVerifyToken("");
    setExistingWhatsappInboxes([]);
    void (async () => {
      try {
        const [cfg, inboxesRes] = await Promise.all([
          api.get<{
            evolutionPlatformQrMode?: boolean;
            evolutionGoPlatformMode?: boolean;
          }>("/settings"),
          api.get<{ data: { id: string; name: string; channelType: string; channelConfig?: unknown }[] }>(
            "/inboxes",
          ).catch(() => ({ data: [] })),
        ]);
        setEvolutionPlatformQrMode(cfg.evolutionPlatformQrMode ?? false);
        setEvolutionGoPlatformMode(cfg.evolutionGoPlatformMode ?? false);
        setExistingWhatsappInboxes(summarizeWhatsappInboxes(inboxesRes.data));
      } catch {
      }
    })();
  }, [open]);

  if (!open) return null;

  const otherWhatsappInboxes = existingWhatsappInboxes.filter(
    (i) => i.provider && i.provider !== waProvider,
  );
  const providerNewInboxNotice =
    channel === "WHATSAPP" && otherWhatsappInboxes.length > 0
      ? t("inboxesPage.wizard.whatsappMeta.providerNewInboxNotice")
          .replace("{newProvider}", whatsappProviderLabel(waProvider))
          .replace(
            "{existing}",
            otherWhatsappInboxes
              .map((i) => `${i.name} (${whatsappProviderLabel(i.provider)})`)
              .join(", "),
          )
      : null;

  const nativeBase =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/v1/public/channels/inboxes`
      : "/api/v1/public/channels/inboxes";
  const legacyInboxBase =
    typeof window !== "undefined" ? `${window.location.origin}/api/v1/public/inbox` : "/api/v1/public/inbox";

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const goBack = () => {
    setError(null);
    if (step === 1) onClose();
    else if (step === 4) {
      onCreated();
      onClose();
    } else setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
  };

  const selectChannel = (ch: InboxChannelId) => {
    setChannel(ch);
    setName(t(`inboxesPage.wizard.channels.${ch}.title`));
    setNativeCfg(emptyNativeCfg());
    setStep(2);
  };

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitDetails = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || !channel) return;
    if (channel === "WHATSAPP" && isWhatsAppCloudApiProvider(waProvider)) {
      if (!waProviderPhoneId.trim()) {
        setError(t("inboxesPage.wizard.whatsappMeta.validationPhoneNumberId"));
        return;
      }
      const existingSame = existingWhatsappInboxes.find((i) => i.provider === waProvider);
      if (existingSame) {
        setError(
          t("inboxesPage.wizard.whatsappMeta.providerAlreadyExists").replace("{name}", existingSame.name),
        );
        return;
      }
      if (!waProviderApiKey.trim()) {
        setError(t("inboxesPage.wizard.whatsappMeta.validationApiKey"));
        return;
      }
    }
    if (channel === "WHATSAPP" && (waProvider === "evolution" || waProvider === "evolution_go")) {
      const existingSame = existingWhatsappInboxes.find((i) => i.provider === waProvider);
      if (existingSame) {
        setError(
          t("inboxesPage.wizard.whatsappMeta.providerAlreadyExists").replace("{name}", existingSame.name),
        );
        return;
      }
      if (!waProviderPhoneId.trim()) {
        setError(t("inboxesPage.wizard.whatsappMeta.validationInstance"));
        return;
      }
    }
    setError(null);
    setStep(3);
  };

  const finishCreate = async (opts?: { clearAgents?: boolean }) => {
    if (!channel) return;
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    setError(null);
    try {
      let channelConfig: Record<string, unknown> | null =
        channel === "WEBSITE"
          ? websiteWidgetToChannelConfig({
              ...websiteWidget,
              siteName: websiteWidget.siteName.trim() || n,
            })
          : (buildChannelConfigPayload(channel, nativeCfg) ?? null);
      if (channel === "WHATSAPP") {
        channelConfig = buildInboxWhatsappChannelConfig(channelConfig, {
          whatsappProvider: waProvider,
          whatsappPhoneNumberId: waProviderPhoneId,
          whatsappApiKey: waProviderApiKey,
          whatsappWebhookSecret: waWebhookSecret,
          evolutionApiBaseUrl: waProviderBaseUrl,
          whatsappDisplayPhone: waDisplayPhone,
          whatsappBusinessAccountId: waWabaId,
        });
      }
      const inbox = await api.post<{
        id: string;
        ingestToken: string | null;
        channelType: string;
        whatsappWebhookUrl?: string;
        whatsappWebhookVerifyToken?: string | null;
      }>("/inboxes", {
        name: n,
        description: description.trim() || null,
        isDefault: isDefault || undefined,
        channelType: channel,
        ...(channelConfig ? { channelConfig } : {}),
        ...(createAgentBotId ? { agentBotId: createAgentBotId } : {}),
      });
      const agentsToAdd = opts?.clearAgents ? [] : [...selectedAgentIds];
      for (const uid of agentsToAdd) {
        try {
          await api.post(`/inboxes/${inbox.id}/members`, { userId: uid });
        } catch {
          /* ignore individual member failures */
        }
      }
      if (channel === "WHATSAPP" && isWhatsAppCloudApiProvider(waProvider)) {
        setWaSetupWebhookUrl(inbox.whatsappWebhookUrl ?? "");
        setWaSetupVerifyToken(inbox.whatsappWebhookVerifyToken ?? "");
      }
      setCreatedInbox(inbox);
      setStep(4);
    } catch {
      setError(t("inboxesPage.wizard.errorCreate"));
    } finally {
      setCreating(false);
    }
  };

  const steps = [
    { num: 1 as const, titleKey: "inboxesPage.wizard.step1Title", descKey: "inboxesPage.wizard.step1Subtitle" },
    { num: 2 as const, titleKey: "inboxesPage.wizard.step2Title", descKey: "inboxesPage.wizard.step2Subtitle" },
    { num: 3 as const, titleKey: "inboxesPage.wizard.step3Title", descKey: "inboxesPage.wizard.step3Subtitle" },
    { num: 4 as const, titleKey: "inboxesPage.wizard.step4Title", descKey: "inboxesPage.wizard.step4Subtitle" },
  ];

  const channelBadge = (ch: InboxChannelId) => {
    if (ch === "WHATSAPP") {
      return (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700 dark:text-emerald-300">
          {t("inboxesPage.wizard.badgeReady")}
        </span>
      );
    }
    return (
      <span className="rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-brand-700 dark:text-brand-300">
        {t("inboxesPage.wizard.badgeNative")}
      </span>
    );
  };

  const updateCfg = (patch: Partial<NativeCfgForm>) => {
    setNativeCfg((prev) => ({ ...prev, ...patch }));
  };

  const channelConfigFields = channel ? (
    <div className="mt-4 space-y-3 rounded-lg border border-ink-200 bg-ink-50/50 p-4 dark:border-ink-600 dark:bg-ink-950/30">
      <p className="text-xs font-medium text-ink-600 dark:text-ink-400">{t("inboxesPage.wizard.nativeCredentials")}</p>
      {channel === "API" && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldWebsiteUrl")}</span>
            <input
              value={nativeCfg.websiteUrl}
              onChange={(e) => updateCfg({ websiteUrl: e.target.value })}
              className="input-field"
              placeholder="https://"
            />
          </label>
        </>
      )}
      {channel === "FACEBOOK" && (
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldMetaVerifyToken")}</span>
          <input
            value={nativeCfg.facebookVerifyToken}
            onChange={(e) => updateCfg({ facebookVerifyToken: e.target.value })}
            className="input-field"
            autoComplete="off"
          />
        </label>
      )}
      {channel === "INSTAGRAM" && (
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldInstagramVerifyToken")}</span>
          <input
            value={nativeCfg.instagramVerifyToken}
            onChange={(e) => updateCfg({ instagramVerifyToken: e.target.value })}
            className="input-field"
            autoComplete="off"
          />
        </label>
      )}
      {channel === "TELEGRAM" && (
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldTelegramBotToken")}</span>
          <input
            value={nativeCfg.telegramBotToken}
            onChange={(e) => updateCfg({ telegramBotToken: e.target.value })}
            className="input-field"
            autoComplete="off"
          />
        </label>
      )}
      {channel === "LINE" && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldLineChannelId")}</span>
            <input
              value={nativeCfg.lineChannelId}
              onChange={(e) => updateCfg({ lineChannelId: e.target.value })}
              className="input-field"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldLineChannelSecret")}</span>
            <input
              value={nativeCfg.lineChannelSecret}
              onChange={(e) => updateCfg({ lineChannelSecret: e.target.value })}
              className="input-field"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">
              {t("inboxesPage.wizard.fieldLineChannelAccessToken")}
            </span>
            <input
              value={nativeCfg.lineChannelAccessToken}
              onChange={(e) => updateCfg({ lineChannelAccessToken: e.target.value })}
              className="input-field"
              autoComplete="off"
            />
          </label>
        </>
      )}
      {(channel === "SMS" || channel === "VOICE") && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldTwilioAccountSid")}</span>
            <input
              value={nativeCfg.twilioAccountSid}
              onChange={(e) => updateCfg({ twilioAccountSid: e.target.value })}
              className="input-field"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldTwilioAuthToken")}</span>
            <input
              value={nativeCfg.twilioAuthToken}
              onChange={(e) => updateCfg({ twilioAuthToken: e.target.value })}
              className="input-field"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldTwilioFromNumber")}</span>
            <input
              value={nativeCfg.twilioFromNumber}
              onChange={(e) => updateCfg({ twilioFromNumber: e.target.value })}
              className="input-field"
              placeholder="+1555…"
            />
          </label>
        </>
      )}
      {channel === "EMAIL" && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldEmailFrom")}</span>
            <input
              value={nativeCfg.emailFromAddress}
              onChange={(e) => updateCfg({ emailFromAddress: e.target.value })}
              className="input-field"
              type="email"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-500">{t("inboxesPage.wizard.fieldEmailSmtpHost")}</span>
            <input
              value={nativeCfg.emailSmtpHost}
              onChange={(e) => updateCfg({ emailSmtpHost: e.target.value })}
              className="input-field"
              placeholder="smtp.gmail.com"
            />
          </label>
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/40 px-4 py-8 backdrop-blur-sm dark:bg-black/55">
      <div
        className="card-surface flex w-full max-w-5xl flex-col overflow-hidden shadow-xl md:flex-row md:max-h-[90vh] dark:border-ink-600 dark:bg-ink-900"
        role="dialog"
        aria-labelledby="inbox-wizard-title"
      >
        <aside className="w-full shrink-0 border-b border-ink-200 bg-ink-50/90 p-5 dark:border-ink-700 dark:bg-ink-950/40 md:w-64 md:border-b-0 md:border-r">
          <button
            type="button"
            onClick={goBack}
            className="btn-ghost -ml-1 mb-4 gap-1 px-1 text-sm text-ink-600 dark:text-ink-400"
          >
            <span aria-hidden>‹</span>
            {step === 4 ? t("inboxesPage.wizard.finish") : t("inboxesPage.wizard.back")}
          </button>
          <h2 id="inbox-wizard-title" className="text-lg font-semibold text-ink-900 dark:text-ink-50">
            {t("inboxesPage.wizard.pageTitle")}
          </h2>
          <nav className="mt-6 space-y-4" aria-label="Steps">
            {steps.map((s) => {
              const active = step === s.num;
              const done = step > s.num;
              return (
                <div
                  key={s.num}
                  className={active ? "opacity-100" : done ? "opacity-80" : "opacity-45"}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        active
                          ? "bg-brand-500 text-white"
                          : done
                            ? "bg-emerald-600 text-white"
                            : "border border-ink-300 bg-white text-ink-400 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-500"
                      }`}
                    >
                      {s.num}
                    </span>
                    <span
                      className={`text-sm font-medium ${active ? "text-ink-900 dark:text-ink-50" : "text-ink-600 dark:text-ink-400"}`}
                    >
                      {t(s.titleKey)}
                    </span>
                  </div>
                  <p className="mt-1 pl-9 text-xs text-ink-500 dark:text-ink-500">{t(s.descKey)}</p>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-ink-200 px-6 py-4 dark:border-ink-700">
            <p className="text-xs text-ink-500 dark:text-ink-500">{t("inboxesPage.wizard.chatwootHint")}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {step === 1 && (
              <div>
                <h3 className="mb-1 text-xl font-semibold text-ink-900 dark:text-ink-50">
                  {t("inboxesPage.wizard.step1Title")}
                </h3>
                <p className="mb-6 text-sm text-ink-600 dark:text-ink-400">{t("inboxesPage.wizard.step1Subtitle")}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {INBOX_CHANNEL_ORDER.map((ch) => {
                    const Icon = CHANNEL_ICONS[ch];
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => selectChannel(ch)}
                        className="card-surface flex flex-col items-start gap-2 border p-4 text-left transition hover:border-brand-400/50 hover:shadow-md dark:border-ink-600 dark:bg-ink-900/80"
                      >
                        <div className="flex w-full items-start justify-between gap-2">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
                            <Icon className="h-5 w-5" />
                          </div>
                          {channelBadge(ch)}
                        </div>
                        <span className="font-medium text-ink-900 dark:text-ink-100">
                          {t(`inboxesPage.wizard.channels.${ch}.title`)}
                        </span>
                        <span className="text-xs text-ink-600 dark:text-ink-400">
                          {t(`inboxesPage.wizard.channels.${ch}.description`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 2 && channel && (
              <form onSubmit={submitDetails} className={channel === "WEBSITE" ? "max-w-5xl" : "max-w-lg"}>
                <h3 className="mb-1 text-xl font-semibold text-ink-900 dark:text-ink-50">
                  {channel === "WEBSITE"
                    ? t("inboxesPage.wizard.websiteChannelTitle")
                    : t("inboxesPage.wizard.step2Title")}
                </h3>
                <p className="mb-2 text-sm text-ink-600 dark:text-ink-400">
                  {channel === "WEBSITE"
                    ? t("inboxesPage.wizard.websiteChannelSubtitle")
                    : channel === "WHATSAPP"
                      ? t("inboxesPage.wizard.whatsappMeta.step2Subtitle")
                      : t("inboxesPage.wizard.step2Subtitle")}
                </p>
                <div
                  className={`mb-4 rounded-lg px-3 py-2 text-xs ${
                    channel === "WHATSAPP"
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                      : "border border-brand-500/20 bg-brand-500/5 text-ink-800 dark:text-ink-200"
                  }`}
                >
                  {channel === "WHATSAPP"
                    ? t("inboxesPage.wizard.channelNoteWhatsApp")
                    : t("inboxesPage.wizard.channelNoteNative")}
                </div>
                <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("inboxesPage.name")}
                </label>
                <input
                  value={name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setName(v);
                    if (channel === "WEBSITE" && !websiteWidget.siteName.trim()) {
                      setWebsiteWidget((w) => ({ ...w, siteName: v }));
                    }
                  }}
                  className="input-field mb-4"
                  required
                />
                <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("inboxesPage.description")}
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-field mb-4"
                />
                {agentBots.length > 0 ? (
                  <div className="mb-4">
                    <label className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-400">
                      {t("inboxesPage.wizard.fieldAgentBot")}
                    </label>
                    <select
                      value={createAgentBotId}
                      onChange={(e) => setCreateAgentBotId(e.target.value)}
                      className="input-field"
                    >
                      <option value="">{t("inboxesPage.agentBotOrgDefault")}</option>
                      {agentBots.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.isActive === false ? ` ${t("inboxesPage.wizard.agentBotInactive")}` : ""}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("inboxesPage.agentBotHint")}</p>
                  </div>
                ) : null}
                {channel === "WEBSITE" ? (
                  <div className="mb-4">
                    <h4 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-200">
                      {t("inboxesPage.wizard.widget.builderTitle")}
                    </h4>
                    <WebsiteWidgetBuilder
                      form={websiteWidget}
                      onChange={(patch) => setWebsiteWidget((w) => ({ ...w, ...patch }))}
                      showEmbed={false}
                    />
                  </div>
                ) : channel === "WHATSAPP" ? (
                  <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                    {providerNewInboxNotice ? (
                      <p className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-950 dark:text-sky-100">
                        {providerNewInboxNotice}
                      </p>
                    ) : null}
                    <WhatsAppProviderConfigFields
                      waProvider={waProvider}
                      onProviderChange={setWaProvider}
                      waDisplayPhone={waDisplayPhone}
                      onDisplayPhoneChange={setWaDisplayPhone}
                      waProviderPhoneId={waProviderPhoneId}
                      onPhoneNumberIdChange={setWaProviderPhoneId}
                      waWabaId={waWabaId}
                      onWabaIdChange={setWaWabaId}
                      waProviderApiKey={waProviderApiKey}
                      onApiKeyChange={setWaProviderApiKey}
                      waWebhookSecret={waWebhookSecret}
                      onWebhookSecretChange={setWaWebhookSecret}
                      waProviderBaseUrl={waProviderBaseUrl}
                      onBaseUrlChange={setWaProviderBaseUrl}
                      evolutionPlatformQrMode={evolutionPlatformQrMode}
                      evolutionGoPlatformMode={evolutionGoPlatformMode}
                    />
                  </div>
                ) : (
                  channelConfigFields
                )}
                <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 dark:border-ink-600"
                  />
                  {t("inboxesPage.setDefault")}
                </label>
                <button type="submit" className="btn-primary">
                  {channel === "WHATSAPP" && isWhatsAppCloudApiProvider(waProvider)
                    ? t("inboxesPage.wizard.whatsappMeta.createChannelButton")
                    : t("inboxesPage.wizard.next")}
                </button>
              </form>
            )}

            {step === 3 && channel && (
              <div className="max-w-lg">
                <h3 className="mb-1 text-xl font-semibold text-ink-900 dark:text-ink-50">
                  {t("inboxesPage.wizard.step3Title")}
                </h3>
                <p className="mb-4 text-sm text-ink-600 dark:text-ink-400">{t("inboxesPage.wizard.step3Subtitle")}</p>
                <ul className="card-surface mb-6 max-h-56 space-y-2 overflow-y-auto border p-2 dark:border-ink-600">
                  {orgUsers
                    .filter((u) => u.role === "AGENT" || u.role === "ADMIN")
                    .map((u) => (
                      <li key={u.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-ink-100 dark:hover:bg-ink-800">
                          <input
                            type="checkbox"
                            checked={selectedAgentIds.has(u.id)}
                            onChange={() => toggleAgent(u.id)}
                            className="rounded border-ink-300 dark:border-ink-600"
                          />
                          <span className="text-sm text-ink-800 dark:text-ink-200">
                            {u.name} <span className="text-ink-500">({u.email})</span>
                          </span>
                        </label>
                      </li>
                    ))}
                </ul>
                {error ? (
                  <p className="mb-3 text-sm text-red-600 dark:text-red-400" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void finishCreate()}
                    disabled={creating}
                    className="btn-primary disabled:opacity-50"
                  >
                    {creating ? t("inboxesPage.creating") : t("inboxesPage.wizard.create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void finishCreate({ clearAgents: true })}
                    disabled={creating}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {t("inboxesPage.wizard.skipAgents")}
                  </button>
                </div>
              </div>
            )}

            {step === 4 && createdInbox && (
              <div className="max-w-2xl">
                <h3 className="mb-2 text-xl font-semibold text-ink-900 dark:text-ink-50">
                  {t("inboxesPage.wizard.step4Title")}
                </h3>
                <p className="mb-4 text-sm text-ink-600 dark:text-ink-300">
                  {createdInbox.channelType === "WEBSITE"
                    ? t("inboxesPage.wizard.step4WebsiteSubtitle")
                    : createdInbox.channelType === "WHATSAPP" && waSetupVerifyToken
                      ? t("inboxesPage.wizard.whatsappMeta.step4WhatsAppSubtitle")
                      : t("inboxesPage.wizard.step4Subtitle")}
                </p>
                {createdInbox.channelType === "WEBSITE" && createdInbox.ingestToken ? (
                  <div className="card-surface mb-6 border p-4 dark:border-ink-600">
                    <p className="mb-2 text-xs font-semibold uppercase text-ink-500">
                      {t("inboxesPage.wizard.widget.tabScript")}
                    </p>
                    <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-50 p-3 text-xs dark:bg-ink-950">
                      {buildWebsiteEmbedScript(
                        typeof window !== "undefined" ? window.location.origin : "",
                        createdInbox.ingestToken,
                      )}
                    </pre>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() =>
                        void copyText(
                          buildWebsiteEmbedScript(
                            typeof window !== "undefined" ? window.location.origin : "",
                            createdInbox.ingestToken!,
                          ),
                        )
                      }
                    >
                      {t("inboxesPage.wizard.ingestCopy")}
                    </button>
                  </div>
                ) : null}
                {createdInbox.channelType === "WHATSAPP" && waSetupVerifyToken ? (
                  <div className="card-surface mb-6 border p-4 dark:border-ink-600">
                    <h4 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">
                      {t("inboxesPage.wizard.whatsappMeta.step4WhatsAppTitle")}
                    </h4>
                    <WhatsAppMetaWebhookCopyPanel
                      webhookUrl={waSetupWebhookUrl}
                      verifyToken={waSetupVerifyToken}
                    />
                  </div>
                ) : createdInbox.channelType === "WHATSAPP" ? (
                  <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-200/90">
                    {t("inboxesPage.wizard.ingestNoteWhatsApp")}
                  </p>
                ) : null}

                {createdInbox.ingestToken && createdInbox.channelType !== "WHATSAPP" ? (
                  <div className="card-surface mb-6 space-y-4 border p-4 text-sm dark:border-ink-600">
                    <p className="text-xs text-ink-600 dark:text-ink-400">{t("inboxesPage.wizard.ingestNativeIntro")}</p>
                    {(createdInbox.channelType === "WEBSITE" || createdInbox.channelType === "API") && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                          {t("inboxesPage.wizard.ingestClientApiUrl")}
                        </p>
                        <p className="mb-1 text-xs text-ink-500">{t("inboxesPage.wizard.ingestClientApiHint")}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs text-ink-800 dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
                            {`${nativeBase}/${createdInbox.ingestToken}/contacts/{visitor_uuid}/messages`}
                          </code>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() =>
                              void copyText(
                                `${nativeBase}/${createdInbox.ingestToken}/contacts/{visitor_uuid}/messages`,
                              )
                            }
                          >
                            {t("inboxesPage.wizard.ingestCopy")}
                          </button>
                        </div>
                      </div>
                    )}
                    {createdInbox.channelType === "FACEBOOK" && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                          {t("inboxesPage.wizard.ingestFacebookUrl")}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
                            {`${nativeBase}/${createdInbox.ingestToken}/facebook`}
                          </code>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() =>
                              void copyText(`${nativeBase}/${createdInbox.ingestToken}/facebook`)
                            }
                          >
                            {t("inboxesPage.wizard.ingestCopy")}
                          </button>
                        </div>
                      </div>
                    )}
                    {createdInbox.channelType === "INSTAGRAM" && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                          {t("inboxesPage.wizard.ingestInstagramUrl")}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
                            {`${nativeBase}/${createdInbox.ingestToken}/instagram`}
                          </code>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() =>
                              void copyText(`${nativeBase}/${createdInbox.ingestToken}/instagram`)
                            }
                          >
                            {t("inboxesPage.wizard.ingestCopy")}
                          </button>
                        </div>
                      </div>
                    )}
                    {createdInbox.channelType === "TELEGRAM" && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                          {t("inboxesPage.wizard.ingestTelegramUrl")}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
                            {`${nativeBase}/${createdInbox.ingestToken}/telegram`}
                          </code>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() =>
                              void copyText(`${nativeBase}/${createdInbox.ingestToken}/telegram`)
                            }
                          >
                            {t("inboxesPage.wizard.ingestCopy")}
                          </button>
                        </div>
                      </div>
                    )}
                    {createdInbox.channelType === "LINE" && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                          {t("inboxesPage.wizard.ingestLineUrl")}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
                            {`${nativeBase}/${createdInbox.ingestToken}/line`}
                          </code>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => void copyText(`${nativeBase}/${createdInbox.ingestToken}/line`)}
                          >
                            {t("inboxesPage.wizard.ingestCopy")}
                          </button>
                        </div>
                      </div>
                    )}
                    {(createdInbox.channelType === "SMS" || createdInbox.channelType === "VOICE") && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                          {t("inboxesPage.wizard.ingestTwilioUrl")}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950 dark:text-emerald-200/90">
                            {`${nativeBase}/${createdInbox.ingestToken}/twilio`}
                          </code>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() =>
                              void copyText(`${nativeBase}/${createdInbox.ingestToken}/twilio`)
                            }
                          >
                            {t("inboxesPage.wizard.ingestCopy")}
                          </button>
                        </div>
                      </div>
                    )}
                    {createdInbox.channelType === "EMAIL" && (
                      <p className="text-sm text-ink-600 dark:text-ink-400">
                        {t("inboxesPage.wizard.ingestEmailHint")}
                      </p>
                    )}
                    <div className="border-t border-ink-200 pt-3 dark:border-ink-700">
                      <p className="mb-1 text-xs font-medium text-ink-500">{t("inboxesPage.wizard.ingestLegacyTitle")}</p>
                      <p className="mb-2 text-xs text-ink-500">{t("inboxesPage.wizard.ingestLegacyBody")}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="max-w-full flex-1 overflow-x-auto rounded border border-ink-200 bg-ink-50 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950">
                          {`${legacyInboxBase}/${createdInbox.ingestToken}/inbound`}
                        </code>
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() =>
                            void copyText(`${legacyInboxBase}/${createdInbox.ingestToken}/inbound`)
                          }
                        >
                          {t("inboxesPage.wizard.ingestCopy")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <p className="mb-6 text-sm text-ink-600 dark:text-ink-400">{t("inboxesPage.wizard.doneHint")}</p>
                <button type="button" onClick={goBack} className="btn-primary">
                  {t("inboxesPage.wizard.finish")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
