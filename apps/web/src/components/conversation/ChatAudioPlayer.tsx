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
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
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
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
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
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("loadeddata", onLoadedData);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("volumechange", onVolumeChange);
    };
  }, [src, syncFromAudio]);

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

  const seekToClientX = useCallback(
    (clientX: number) => {
      const bar = progressRef.current;
      const audio = audioRef.current;
      if (!bar || !audio || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      audio.currentTime = pct * duration;
      setCurrentTime(audio.currentTime);
    },
    [duration],
  );

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

  const controlTone = outbound
    ? "text-brand-900/80 dark:text-brand-50/90"
    : "text-ink-600 dark:text-ink-200/90";

  const trackTone = outbound
    ? "bg-brand-900/10 dark:bg-white/12"
    : "bg-ink-900/10 dark:bg-white/12";

  const speedLabel = playbackRate === 1 ? "1×" : `${playbackRate}×`;

  return (
    <div
      className={clsx(
        "chat-audio-player w-full min-w-[200px] max-w-[280px]",
        className,
      )}
    >
      <audio ref={audioRef} src={src} preload="auto" playsInline className="sr-only" />

      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => void togglePlay()}
          aria-label={playing ? t("conversationDetail.audioPause") : t("conversationDetail.audioPlay")}
          className={clsx(
            "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-150",
            "bg-brand-500 text-white hover:bg-brand-600 active:scale-95",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-1",
            "dark:bg-brand-500/90 dark:hover:bg-brand-400",
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
              if (!audio || duration <= 0) return;
              const step = event.shiftKey ? 5 : 1;
              if (event.key === "ArrowRight") {
                event.preventDefault();
                audio.currentTime = Math.min(duration, audio.currentTime + step);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                audio.currentTime = Math.max(0, audio.currentTime - step);
              }
            }}
            className={clsx(
              "group relative h-1 cursor-pointer rounded-full transition-colors duration-150",
              trackTone,
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50",
            )}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-brand-500 transition-[width] duration-150 dark:bg-brand-400"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className={clsx(
                "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-brand-500 opacity-0 transition-opacity duration-150",
                "group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-brand-300",
              )}
              style={{ left: `calc(${progressPct}% - 5px)` }}
              aria-hidden
            />
          </div>
          <div className={clsx("mt-1 flex items-center justify-between tabular-nums", controlTone)}>
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
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150",
              controlTone,
              "hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/8 dark:active:bg-white/12",
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
                "min-w-[2rem] rounded-md px-1.5 py-1 text-[10px] font-semibold leading-none transition-colors duration-150",
                controlTone,
                "hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/8 dark:active:bg-white/12",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50",
                speedOpen && "bg-black/5 dark:bg-white/8",
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
  );
}
