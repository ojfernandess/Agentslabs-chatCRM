import clsx from "clsx";
import { Mic, RotateCcw, Send, Square, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type RecordingPanelProps = {
  seconds: number;
  onStop: () => void;
};

export function VoiceRecordingPanel({ seconds, onStop }: RecordingPanelProps) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-red-200/80 bg-gradient-to-br from-red-50/90 to-rose-50/50 p-4 shadow-sm dark:border-red-900/40 dark:from-red-950/40 dark:to-rose-950/20">
      <div className="flex items-center gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-md shadow-red-500/30">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-30" />
          <Mic className="relative h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-900 dark:text-red-100">{t("conversationDetail.recording")}</p>
          <p className="mt-0.5 font-mono text-lg tabular-nums tracking-wide text-red-700 dark:text-red-200">
            {formatDuration(seconds)}
          </p>
          <p className="mt-1 text-[11px] text-red-700/80 dark:text-red-300/80">
            {t("conversationDetail.recordingStopHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={onStop}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
          {t("conversationDetail.stopRecording")}
        </button>
      </div>
      <div className="mt-3 flex h-8 items-end justify-center gap-1 px-2">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-red-400/70 dark:bg-red-500/60"
            style={{
              height: `${12 + ((i * 7 + seconds * 3) % 20)}px`,
              animation: "pulse 1.2s ease-in-out infinite",
              animationDelay: `${(i % 6) * 0.08}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

type PreviewPanelProps = {
  previewUrl: string;
  busy: boolean;
  sendDisabled?: boolean;
  onDiscard: () => void;
  onSend: () => void;
};

export function VoicePreviewPanel({ previewUrl, busy, sendDisabled, onDiscard, onSend }: PreviewPanelProps) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50/80 to-white p-4 shadow-sm dark:border-brand-800/40 dark:from-brand-950/30 dark:to-ink-950/40">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
          <Mic className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
            {t("conversationDetail.voicePreviewTitle")}
          </p>
          <p className="mt-0.5 text-xs text-ink-600 dark:text-ink-300">{t("conversationDetail.voicePreviewHint")}</p>
        </div>
      </div>
      <div className="rounded-xl border border-ink-100 bg-white/90 px-3 py-2.5 dark:border-ink-700 dark:bg-ink-900/80">
        <audio key={previewUrl} controls src={previewUrl} className="h-10 w-full max-w-full" preload="metadata" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3.5 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("conversationDetail.voicePreviewDiscard")}
        </button>
        <button
          type="button"
          disabled={busy || sendDisabled}
          onClick={onSend}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50",
            "bg-brand-500 hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500",
          )}
        >
          {busy ? <RotateCcw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t("conversationDetail.voicePreviewSend")}
        </button>
      </div>
    </div>
  );
}
