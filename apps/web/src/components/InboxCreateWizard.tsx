import { useState, useEffect, type FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
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

const CHANNEL_ICONS: Record<InboxChannelId, LucideIcon> = {
  WEBSITE: PanelTop,
  FACEBOOK: Share2,
  WHATSAPP: MessageSquare,
  SMS: Smartphone,
  EMAIL: Mail,
  API: Code2,
  TELEGRAM: Send,
  LINE: Globe,
  INSTAGRAM: ImageIcon,
  VOICE: Phone,
};

type OrgUser = { id: string; name: string; email: string; role: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  orgUsers: OrgUser[];
};

export function InboxCreateWizard({ open, onClose, onCreated, orgUsers }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [channel, setChannel] = useState<InboxChannelId | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInbox, setCreatedInbox] = useState<{
    id: string;
    ingestToken: string | null;
    channelType: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setChannel(null);
    setName("");
    setDescription("");
    setIsDefault(false);
    setSelectedAgentIds(new Set());
    setCreating(false);
    setError(null);
    setCreatedInbox(null);
  }, [open]);

  if (!open) return null;

  const baseApiUrl =
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
    setStep(3);
  };

  const finishCreate = async () => {
    if (!channel) return;
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    setError(null);
    try {
      const inbox = await api.post<{ id: string; ingestToken: string | null; channelType: string }>("/inboxes", {
        name: n,
        description: description.trim() || null,
        isDefault: isDefault || undefined,
        channelType: channel,
      });
      for (const uid of selectedAgentIds) {
        try {
          await api.post(`/inboxes/${inbox.id}/members`, { userId: uid });
        } catch {
          /* ignore individual member failures */
        }
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

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/50 px-4 py-8 backdrop-blur-sm">
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-ink-600 bg-[#151d28] text-ink-100 shadow-xl md:flex-row md:max-h-[90vh]"
        role="dialog"
        aria-labelledby="inbox-wizard-title"
      >
        <aside className="w-full shrink-0 border-b border-ink-700 p-5 md:w-64 md:border-b-0 md:border-r md:border-ink-700">
          <button
            type="button"
            onClick={goBack}
            className="mb-4 flex items-center gap-1 text-sm text-ink-400 transition hover:text-ink-100"
          >
            <span aria-hidden>‹</span>
            {step === 4 ? t("inboxesPage.wizard.finish") : t("inboxesPage.wizard.back")}
          </button>
          <h2 id="inbox-wizard-title" className="text-lg font-semibold text-white">
            {t("inboxesPage.wizard.pageTitle")}
          </h2>
          <nav className="mt-6 space-y-4" aria-label="Steps">
            {steps.map((s) => {
              const active = step === s.num;
              const done = step > s.num;
              return (
                <div
                  key={s.num}
                  className={active ? "opacity-100" : done ? "opacity-70" : "opacity-40"}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        active
                          ? "bg-brand-500 text-white"
                          : done
                            ? "bg-emerald-600/80 text-white"
                            : "border border-ink-600 bg-ink-900 text-ink-500"
                      }`}
                    >
                      {s.num}
                    </span>
                    <span className={`text-sm font-medium ${active ? "text-white" : "text-ink-300"}`}>
                      {t(s.titleKey)}
                    </span>
                  </div>
                  <p className="mt-1 pl-9 text-xs text-ink-500">{t(s.descKey)}</p>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-ink-700 px-6 py-4">
            <p className="text-xs text-ink-500">{t("inboxesPage.wizard.chatwootHint")}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {step === 1 && (
              <div>
                <h3 className="mb-1 text-xl font-semibold text-white">{t("inboxesPage.wizard.step1Title")}</h3>
                <p className="mb-6 text-sm text-ink-400">{t("inboxesPage.wizard.step1Subtitle")}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {INBOX_CHANNEL_ORDER.map((ch) => {
                    const Icon = CHANNEL_ICONS[ch];
                    const whatsappReady = ch === "WHATSAPP";
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => selectChannel(ch)}
                        className="flex flex-col items-start gap-2 rounded-xl border border-ink-600 bg-[#1a2532] p-4 text-left transition hover:border-brand-500/50 hover:bg-[#1f2d3d]"
                      >
                        <div className="flex w-full items-start justify-between gap-2">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-800 text-brand-300">
                            <Icon className="h-5 w-5" strokeWidth={1.75} />
                          </div>
                          {whatsappReady ? (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-300">
                              {t("inboxesPage.wizard.badgeReady")}
                            </span>
                          ) : (
                            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sky-200">
                              {t("inboxesPage.wizard.badgeWebhook")}
                            </span>
                          )}
                        </div>
                        <span className="font-medium text-white">{t(`inboxesPage.wizard.channels.${ch}.title`)}</span>
                        <span className="text-xs text-ink-400">{t(`inboxesPage.wizard.channels.${ch}.description`)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {step === 2 && channel && (
              <form onSubmit={submitDetails} className="max-w-lg">
                <h3 className="mb-1 text-xl font-semibold text-white">{t("inboxesPage.wizard.step2Title")}</h3>
                <p className="mb-2 text-sm text-ink-400">{t("inboxesPage.wizard.step2Subtitle")}</p>
                <div
                  className={`mb-4 rounded-lg px-3 py-2 text-xs ${
                    channel === "WHATSAPP"
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border border-amber-500/25 bg-amber-500/10 text-amber-100/90"
                  }`}
                >
                  {channel === "WHATSAPP"
                    ? t("inboxesPage.wizard.channelNoteWhatsApp")
                    : t("inboxesPage.wizard.channelNoteOther")}
                </div>
                <label className="mb-1 block text-xs font-medium text-ink-400">{t("inboxesPage.name")}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mb-4 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-white"
                  required
                />
                <label className="mb-1 block text-xs font-medium text-ink-400">{t("inboxesPage.description")}</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mb-4 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-white"
                />
                <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-ink-200">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded border-ink-600 bg-ink-900"
                  />
                  {t("inboxesPage.setDefault")}
                </label>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
                >
                  {t("inboxesPage.wizard.next")}
                </button>
              </form>
            )}

            {step === 3 && channel && (
              <div className="max-w-lg">
                <h3 className="mb-1 text-xl font-semibold text-white">{t("inboxesPage.wizard.step3Title")}</h3>
                <p className="mb-4 text-sm text-ink-400">{t("inboxesPage.wizard.step3Subtitle")}</p>
                <ul className="mb-6 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-ink-600 p-2">
                  {orgUsers
                    .filter((u) => u.role === "AGENT" || u.role === "ADMIN")
                    .map((u) => (
                      <li key={u.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-ink-800">
                          <input
                            type="checkbox"
                            checked={selectedAgentIds.has(u.id)}
                            onChange={() => toggleAgent(u.id)}
                            className="rounded border-ink-600"
                          />
                          <span className="text-sm">
                            {u.name} <span className="text-ink-500">({u.email})</span>
                          </span>
                        </label>
                      </li>
                    ))}
                </ul>
                {error ? (
                  <p className="mb-3 text-sm text-red-400" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void finishCreate()}
                    disabled={creating}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                  >
                    {creating ? t("inboxesPage.creating") : t("inboxesPage.wizard.create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void finishCreate()}
                    disabled={creating}
                    className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-50"
                  >
                    {t("inboxesPage.wizard.skipAgents")}
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="max-w-lg">
                <h3 className="mb-2 text-xl font-semibold text-white">{t("inboxesPage.wizard.step4Title")}</h3>
                <p className="mb-4 text-sm text-ink-300">{t("inboxesPage.wizard.step4Subtitle")}</p>
                {createdInbox?.ingestToken ? (
                  <div className="mb-6 space-y-4 rounded-lg border border-ink-600 bg-ink-900/50 p-4 text-sm">
                    {createdInbox.channelType === "WHATSAPP" ? (
                      <p className="text-amber-200/90">{t("inboxesPage.wizard.ingestNoteWhatsApp")}</p>
                    ) : null}
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                        {t("inboxesPage.wizard.ingestJsonUrl")}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="max-w-full flex-1 overflow-x-auto rounded bg-ink-950 px-2 py-1.5 text-xs text-emerald-200/90">
                          {`${baseApiUrl}/${createdInbox.ingestToken}/inbound`}
                        </code>
                        <button
                          type="button"
                          className="rounded bg-ink-700 px-2 py-1 text-xs text-white hover:bg-ink-600"
                          onClick={() =>
                            void copyText(`${baseApiUrl}/${createdInbox.ingestToken}/inbound`)
                          }
                        >
                          {t("inboxesPage.wizard.ingestCopy")}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                        {t("inboxesPage.wizard.ingestTelegramUrl")}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="max-w-full flex-1 overflow-x-auto rounded bg-ink-950 px-2 py-1.5 text-xs text-emerald-200/90">
                          {`${baseApiUrl}/${createdInbox.ingestToken}/telegram`}
                        </code>
                        <button
                          type="button"
                          className="rounded bg-ink-700 px-2 py-1 text-xs text-white hover:bg-ink-600"
                          onClick={() =>
                            void copyText(`${baseApiUrl}/${createdInbox.ingestToken}/telegram`)
                          }
                        >
                          {t("inboxesPage.wizard.ingestCopy")}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase text-ink-500">
                        {t("inboxesPage.wizard.ingestTwilioUrl")}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="max-w-full flex-1 overflow-x-auto rounded bg-ink-950 px-2 py-1.5 text-xs text-emerald-200/90">
                          {`${baseApiUrl}/${createdInbox.ingestToken}/twilio`}
                        </code>
                        <button
                          type="button"
                          className="rounded bg-ink-700 px-2 py-1 text-xs text-white hover:bg-ink-600"
                          onClick={() => void copyText(`${baseApiUrl}/${createdInbox.ingestToken}/twilio`)}
                        >
                          {t("inboxesPage.wizard.ingestCopy")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <p className="mb-6 text-sm text-ink-400">{t("inboxesPage.wizard.doneHint")}</p>
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
                >
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
