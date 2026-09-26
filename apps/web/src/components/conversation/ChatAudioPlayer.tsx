import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

type Props = {
  src: string;
  /** Mensagem enviada pelo agente (bolha outbound). */
  outbound?: boolean;
  className?: string;
};

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** OGG/WhatsApp sem byte-range costuma expor duration=Infinity até buffer completo — usa seekable. */
function resolveAudioDuration(audio: HTMLAudioElement): number {
  const direct = audio.duration;
  if (Number.isFinite(direct) && direct > 0) return direct;
  try {
    const len = audio.seekable?.length ?? 0;
    if (len > 0) {
      const end = audio.seekable.end(len - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    /* seekable indisponível */
  }
  return 0;
}

export function ChatAudioPlayer({ src, outbound = false, className }: Props) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const volumeMenuRef = useRef<HTMLDivElement>(null);
  const speedButtonRef = useRef<HTMLButtonElement>(null);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const draggingRef = useRef(false);
  const progressId = useId();

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const syncFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    setDuration(resolveAudioDuration(audio));
    setPlaying(!audio.paused && !audio.ended);
    setLoading(audio.readyState < 2);
    setVolume(audio.volume);
    setMuted(audio.muted);
    setPlaybackRate(audio.playbackRate);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setPlaying(true);
      setLoading(false);
    };
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setDuration(resolveAudioDuration(audio));
    };
    const onDurationChange = () => setDuration(resolveAudioDuration(audio));
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onLoadedData = () => setLoading(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onVolumeChange = () => {
      setVolume(audio.volume);
      setMuted(audio.muted);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("loadedmetadata", onDurationChange);
    audio.addEventListener("progress", onDurationChange);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("loadeddata", onLoadedData);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("volumechange", onVolumeChange);

    syncFromAudio();

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("loadedmetadata", onDurationChange);
      audio.removeEventListener("progress", onDurationChange);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("loadeddata", onLoadedData);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("volumechange", onVolumeChange);
    };
  }, [src, syncFromAudio]);

  useEffect(() => {
    if (!playing) return;
    const audio = audioRef.current;
    if (!audio) return;

    let rafId = 0;
    const tick = () => {
      setCurrentTime(audio.currentTime);
      setDuration(resolveAudioDuration(audio));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, src]);

  useEffect(() => {
    if (!speedOpen && !volumeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (speedOpen && !speedMenuRef.current?.contains(target) && !speedButtonRef.current?.contains(target)) {
        setSpeedOpen(false);
      }
      if (volumeOpen && !volumeMenuRef.current?.contains(target) && !volumeButtonRef.current?.contains(target)) {
        setVolumeOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [speedOpen, volumeOpen]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        /* autoplay policy or load error */
      }
    } else {
      audio.pause();
    }
  };

  const seekToClientX = useCallback((clientX: number) => {
    const bar = progressRef.current;
    const audio = audioRef.current;
    if (!bar || !audio) return;
    const dur = resolveAudioDuration(audio);
    if (dur <= 0) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = pct * dur;
    setCurrentTime(audio.currentTime);
    setDuration(dur);
  }, []);

  const onProgressPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToClientX(event.clientX);
  };

  const onProgressPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekToClientX(event.clientX);
  };

  const onProgressPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const setSpeed = (rate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    setPlaybackRate(rate);
    setSpeedOpen(false);
  };

  const onVolumeChange = (next: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.min(1, Math.max(0, next));
    audio.volume = clamped;
    if (clamped > 0) audio.muted = false;
    setVolume(clamped);
    setMuted(audio.muted);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  const speedLabel = playbackRate === 1 ? "1×" : `${playbackRate}×`;

  return (
    <div
      className={clsx(
        "chat-audio-player w-full min-w-[200px] max-w-[280px]",
        outbound ? "chat-audio-player--outbound" : "chat-audio-player--inbound",
        className,
      )}
    >
      <audio ref={audioRef} src={src} preload="auto" playsInline className="sr-only" />

      <div className="chat-audio-player__surface">
        <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => void togglePlay()}
          aria-label={playing ? t("conversationDetail.audioPause") : t("conversationDetail.audioPlay")}
          className={clsx(
            "chat-audio-player__play relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-1",
            "active:scale-95",
            outbound && "shadow-sm shadow-brand-900/10 dark:shadow-black/20",
          )}
        >
          {loading && !playing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="h-4 w-4 fill-current" aria-hidden />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden />
          )}
        </button>

        <div className="min-w-0 flex-1 pt-0.5">
          <div
            ref={progressRef}
            id={progressId}
            role="slider"
            aria-label={t("conversationDetail.audioSeek")}
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration) || 0}
            aria-valuenow={Math.floor(currentTime)}
            tabIndex={0}
            onPointerDown={onProgressPointerDown}
            onPointerMove={onProgressPointerMove}
            onPointerUp={onProgressPointerUp}
            onPointerCancel={onProgressPointerUp}
            onKeyDown={(event) => {
              const audio = audioRef.current;
              if (!audio) return;
              const dur = resolveAudioDuration(audio);
              if (dur <= 0) return;
              const step = event.shiftKey ? 5 : 1;
              if (event.key === "ArrowRight") {
                event.preventDefault();
                audio.currentTime = Math.min(dur, audio.currentTime + step);
                setCurrentTime(audio.currentTime);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                audio.currentTime = Math.max(0, audio.currentTime - step);
                setCurrentTime(audio.currentTime);
              }
            }}
            className={clsx(
              "group relative flex min-h-[18px] cursor-pointer items-center rounded-full py-1.5",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50",
            )}
          >
            <div className="chat-audio-player__track relative h-1 w-full rounded-full">
              <div
                className="chat-audio-player__progress-fill pointer-events-none absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${progressPct}%` }}
              />
              <div
                className={clsx(
                  "chat-audio-player__progress-thumb pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full opacity-0 transition-opacity duration-150",
                  "group-hover:opacity-100 group-focus-visible:opacity-100",
                )}
                style={{ left: `calc(${progressPct}% - 5px)` }}
                aria-hidden
              />
            </div>
          </div>
          <div className="chat-audio-player__control mt-1 flex items-center justify-between tabular-nums opacity-80">
            <span className="text-[10px] leading-none">{formatAudioTime(currentTime)}</span>
            <span className="text-[10px] leading-none">
              {duration > 0 ? formatAudioTime(duration) : "—"}
            </span>
          </div>
        </div>

        <div className="relative flex shrink-0 items-center gap-0.5 pt-0.5">
          <button
            ref={volumeButtonRef}
            type="button"
            onClick={() => {
              setVolumeOpen((open) => !open);
              setSpeedOpen(false);
            }}
            aria-label={muted || volume === 0 ? t("conversationDetail.audioUnmute") : t("conversationDetail.audioVolume")}
            className={clsx(
              "chat-audio-player__control flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50",
            )}
          >
            {muted || volume === 0 ? (
              <VolumeX className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Volume2 className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>

          {volumeOpen ? (
            <div
              ref={volumeMenuRef}
              className={clsx(
                "absolute right-0 top-full z-20 mt-1 rounded-lg border px-2.5 py-2 shadow-sm",
                "border-ink-200/80 bg-white/95 backdrop-blur-sm dark:border-soft-border dark:bg-soft-surface-2/95",
              )}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
                aria-label={t("conversationDetail.audioVolume")}
                className="chat-audio-volume-slider h-1 w-24 cursor-pointer accent-brand-500"
              />
              <button
                type="button"
                onClick={toggleMute}
                className="mt-1.5 w-full text-center text-[10px] font-medium text-ink-500 hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-300"
              >
                {muted ? t("conversationDetail.audioUnmute") : t("conversationDetail.audioMute")}
              </button>
            </div>
          ) : null}

          <div className="relative">
            <button
              ref={speedButtonRef}
              type="button"
              onClick={() => {
                setSpeedOpen((open) => !open);
                setVolumeOpen(false);
              }}
              aria-label={t("conversationDetail.audioSpeed")}
              aria-expanded={speedOpen}
              className={clsx(
                "chat-audio-player__control min-w-[2rem] rounded-md px-1.5 py-1 text-[10px] font-semibold leading-none transition-colors duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50",
                speedOpen && "opacity-100",
              )}
            >
              {speedLabel}
            </button>

            {speedOpen ? (
              <div
                ref={speedMenuRef}
                role="menu"
                className={clsx(
                  "absolute right-0 top-full z-20 mt-1 min-w-[4.5rem] overflow-hidden rounded-lg border py-1 shadow-sm",
                  "border-ink-200/80 bg-white/95 backdrop-blur-sm dark:border-soft-border dark:bg-soft-surface-2/95",
                )}
              >
                {SPEED_OPTIONS.map((rate) => {
                  const active = playbackRate === rate;
                  const label = rate === 1 ? "1×" : `${rate}×`;
                  return (
                    <button
                      key={rate}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => setSpeed(rate)}
                      className={clsx(
                        "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition-colors duration-150",
                        active
                          ? "bg-brand-500/10 font-semibold text-brand-700 dark:bg-brand-400/15 dark:text-brand-200"
                          : "text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5",
                      )}
                    >
                      <span>{label}</span>
                      {active ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

/** Pré-visualização estática em Configurações → Aparência. */
export function ChatAudioPlayerPreview({ outbound = true }: { outbound?: boolean }) {
  return (
    <div
      className={clsx(
        "chat-audio-player mt-2 w-full max-w-[220px]",
        outbound ? "chat-audio-player--outbound" : "chat-audio-player--inbound",
      )}
      aria-hidden
    >
      <div className="chat-audio-player__surface">
        <div className="flex items-start gap-2.5">
          <div className="chat-audio-player__play flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="chat-audio-player__track relative h-1 rounded-full">
              <div className="chat-audio-player__progress-fill absolute inset-y-0 left-0 w-[35%] rounded-full" />
            </div>
            <div className="chat-audio-player__control mt-1 flex items-center justify-between text-[10px] leading-none opacity-80">
              <span>0:01</span>
              <span>0:03</span>
            </div>
          </div>
          <div className="chat-audio-player__control flex shrink-0 items-center gap-0.5 pt-0.5 text-[10px] font-semibold">
            <Volume2 className="h-3.5 w-3.5" />
            <span>1×</span>
          </div>
        </div>
      </div>
    </div>
  );
}
