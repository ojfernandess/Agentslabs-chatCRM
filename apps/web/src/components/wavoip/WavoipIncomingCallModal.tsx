import { Phone, PhoneOff, MessageSquare } from "lucide-react";
import { motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useWavoipVoice } from "@/contexts/WavoipVoiceContext";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function WavoipIncomingCallModal() {
  const { t } = useI18n();
  const {
    incomingOffer,
    incomingScreenPopContactName,
    incomingScreenPopConversationId,
    acceptIncoming,
    rejectIncoming,
    openIncomingConversation,
  } = useWavoipVoice();

  if (!incomingOffer) return null;

  const peerLabel =
    incomingScreenPopContactName?.trim() ||
    incomingOffer.peer.displayName?.trim() ||
    incomingOffer.peer.phone ||
    t("wavoip.voice.unknownCaller");

  const phone = incomingOffer.peer.phone?.trim() ?? "";

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="pointer-events-auto absolute inset-0 bg-slate-950/55 backdrop-blur-md"
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-8 text-center shadow-2xl shadow-emerald-900/30"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wavoip-incoming-title"
      >
        <div
          className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-emerald-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-teal-400/15 blur-3xl"
          aria-hidden
        />

        <p
          id="wavoip-incoming-title"
          className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400/90"
        >
          {t("wavoip.voice.incomingTitle")}
        </p>
        <p className="mt-1 text-[11px] font-medium text-slate-400">{t("wavoip.voice.incomingChannel")}</p>

        <div className="relative mx-auto mt-8 flex h-28 w-28 items-center justify-center">
          <span
            className="absolute inset-0 animate-ping rounded-full bg-emerald-500/25"
            style={{ animationDuration: "2s" }}
            aria-hidden
          />
          <span
            className="absolute inset-2 animate-pulse rounded-full bg-emerald-500/15"
            aria-hidden
          />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-2xl font-bold text-white shadow-lg shadow-emerald-900/40 ring-4 ring-emerald-500/30">
            {initialsFromName(peerLabel)}
          </div>
        </div>

        <h2 className="mt-6 truncate text-2xl font-semibold tracking-tight text-white">{peerLabel}</h2>
        {phone ? (
          <p className="mt-1 font-mono text-sm text-slate-400">{phone}</p>
        ) : null}
        <p className="mt-3 text-sm font-medium text-emerald-300/90">{t("wavoip.voice.callStatus.RINGING")}</p>

        {incomingScreenPopConversationId ? (
          <button
            type="button"
            onClick={() => openIncomingConversation()}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {t("wavoip.voice.openConversation")}
          </button>
        ) : null}

        <div className="mt-8 flex items-center justify-center gap-10">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void rejectIncoming()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-red-500 to-red-700 text-white shadow-lg shadow-red-900/40 transition hover:scale-105 active:scale-95"
              aria-label={t("wavoip.voice.reject")}
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <span className="text-xs font-medium text-slate-400">{t("wavoip.voice.reject")}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void acceptIncoming()}
              className="flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/50 ring-4 ring-emerald-400/30 transition hover:scale-105 active:scale-95"
              aria-label={t("wavoip.voice.accept")}
            >
              <Phone className="h-8 w-8" />
            </button>
            <span className="text-xs font-medium text-emerald-300/90">{t("wavoip.voice.accept")}</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
