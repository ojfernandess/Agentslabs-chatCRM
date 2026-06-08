import { ChevronDown, ChevronUp, MessageSquare, Minus, Phone, PhoneOff } from "lucide-react";
import { motion, AnimatePresence } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useWavoipVoice } from "@/contexts/WavoipVoiceContext";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Chamada recebida: não bloqueia o CRM — pode minimizar e continuar a navegar. */
export function WavoipIncomingCallModal() {
  const { t } = useI18n();
  const {
    incomingOffer,
    incomingCallCount,
    incomingMinimized,
    minimizeIncoming,
    expandIncoming,
    cycleIncomingCall,
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

  if (incomingMinimized) {
    return (
      <div className="pointer-events-none fixed bottom-24 right-4 z-[120] flex flex-col items-end gap-2 sm:bottom-6">
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => expandIncoming()}
          className="pointer-events-auto flex max-w-[min(100vw-2rem,20rem)] items-center gap-3 rounded-2xl border border-emerald-500/40 bg-slate-900/95 py-2.5 pl-2.5 pr-4 text-left shadow-xl shadow-emerald-900/30 backdrop-blur-md"
        >
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-bold text-white">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/40" aria-hidden />
            {initialsFromName(peerLabel)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{peerLabel}</span>
            <span className="text-xs text-emerald-300">{t("wavoip.voice.callStatus.RINGING")}</span>
          </span>
          {incomingCallCount > 1 ? (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-200">
              {incomingCallCount}
            </span>
          ) : null}
          <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        </motion.button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex max-h-[min(100vh-2rem,42rem)] w-full max-w-sm flex-col p-0 sm:bottom-6 sm:right-6">
      <AnimatePresence>
        <motion.div
          key="incoming-panel"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="pointer-events-auto flex max-h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 shadow-2xl shadow-emerald-900/25"
          role="dialog"
          aria-modal="false"
          aria-labelledby="wavoip-incoming-title"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400/90">
              {t("wavoip.voice.incomingTitle")}
              {incomingCallCount > 1
                ? ` · ${t("wavoip.voice.incomingQueueCount").replace("{count}", String(incomingCallCount))}`
                : ""}
            </p>
            <div className="flex items-center gap-1">
              {incomingCallCount > 1 ? (
                <button
                  type="button"
                  onClick={() => cycleIncomingCall()}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                  title={t("wavoip.voice.nextIncomingCall")}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => minimizeIncoming()}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                title={t("wavoip.voice.minimize")}
                aria-label={t("wavoip.voice.minimize")}
              >
                <Minus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-6 text-center">
            <p className="text-[11px] font-medium text-slate-400">{t("wavoip.voice.incomingChannel")}</p>
            <p className="mt-1 text-xs text-slate-500">{t("wavoip.voice.incomingNonBlockingHint")}</p>
            {incomingCallCount > 1 ? (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {t("wavoip.voice.incomingQueueCount").replace("{count}", String(incomingCallCount))} —{" "}
                {t("wavoip.voice.queuedCallPulse")}
              </p>
            ) : null}

            <div className="relative mx-auto mt-6 flex h-24 w-24 items-center justify-center">
              <span
                className="absolute inset-0 animate-ping rounded-full bg-emerald-500/25"
                style={{ animationDuration: "2s" }}
                aria-hidden
              />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-xl font-bold text-white ring-4 ring-emerald-500/30">
                {initialsFromName(peerLabel)}
              </div>
            </div>

            <h2 id="wavoip-incoming-title" className="mt-4 truncate text-xl font-semibold text-white">
              {peerLabel}
            </h2>
            {phone ? <p className="mt-1 font-mono text-sm text-slate-400">{phone}</p> : null}

            {incomingScreenPopConversationId ? (
              <button
                type="button"
                onClick={() => openIncomingConversation()}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {t("wavoip.voice.openConversation")}
              </button>
            ) : null}

            <div className="mt-6 flex items-center justify-center gap-8">
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => void rejectIncoming()}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-red-500 to-red-700 text-white shadow-lg transition hover:scale-105 active:scale-95"
                  aria-label={t("wavoip.voice.reject")}
                >
                  <PhoneOff className="h-6 w-6" />
                </button>
                <span className="text-xs text-slate-400">{t("wavoip.voice.reject")}</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => void acceptIncoming()}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-lg ring-4 ring-emerald-400/25 transition hover:scale-105 active:scale-95"
                  aria-label={t("wavoip.voice.accept")}
                >
                  <Phone className="h-7 w-7" />
                </button>
                <span className="text-xs font-medium text-emerald-300">{t("wavoip.voice.accept")}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
