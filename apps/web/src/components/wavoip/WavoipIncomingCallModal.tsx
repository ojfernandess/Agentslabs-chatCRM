import { Phone, PhoneOff } from "lucide-react";
import { motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useWavoipVoice } from "@/contexts/WavoipVoiceContext";

export function WavoipIncomingCallModal() {
  const { t } = useI18n();
  const { incomingOffer, acceptIncoming, rejectIncoming } = useWavoipVoice();

  if (!incomingOffer) return null;

  const peerLabel =
    incomingOffer.peer.displayName?.trim() ||
    incomingOffer.peer.phone ||
    t("wavoip.voice.unknownCaller");

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-end justify-center p-4 sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 shadow-2xl ring-4 ring-emerald-500/20 dark:border-emerald-900/50 dark:bg-ink-900"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          {t("wavoip.voice.incomingTitle")}
        </p>
        <p className="mt-2 text-xl font-bold text-slate-900 dark:text-ink-50">{peerLabel}</p>
        {incomingOffer.peer.phone ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">{incomingOffer.peer.phone}</p>
        ) : null}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => void rejectIncoming()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <PhoneOff className="h-4 w-4" />
            {t("wavoip.voice.reject")}
          </button>
          <button
            type="button"
            onClick={() => void acceptIncoming()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Phone className="h-4 w-4" />
            {t("wavoip.voice.accept")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
