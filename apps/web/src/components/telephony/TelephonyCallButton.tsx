import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Phone, PhoneCall } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { formatCallDuration } from "@/lib/callDuration";
import { mapNvoipCallErrorMessage } from "@/lib/mapNvoipCallError";
import type { ActiveVoiceCall } from "@/lib/activeVoiceCall";
import { useTelephonyProviders, type TelephonyProviderId } from "@/hooks/useTelephonyProviders";

type Props = {
  phone: string | null | undefined;
  inboxId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  stopPropagation?: boolean;
  activeVoiceCall?: ActiveVoiceCall | null;
  peerOnCall?: { agentName: string } | null;
};

const PROVIDER_LABEL_KEYS: Record<TelephonyProviderId, string> = {
  wavoip: "telephony.call.wavoip",
  nvoip: "telephony.call.nvoip",
  threecx: "telephony.call.threecx",
};

const PROVIDER_ACCENT: Record<TelephonyProviderId, string> = {
  wavoip: "text-emerald-700 dark:text-emerald-300",
  nvoip: "text-orange-700 dark:text-orange-300",
  threecx: "text-violet-700 dark:text-violet-300",
};

export function TelephonyCallButton({
  phone,
  inboxId,
  conversationId,
  contactId,
  className,
  compact,
  iconOnly,
  stopPropagation,
  activeVoiceCall,
  peerOnCall,
}: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { providers, wavoipVoice, nvoipVoice, threecxVoice } = useTelephonyProviders();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<TelephonyProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!phone?.trim() || providers.length === 0) return null;

  const onThisConversation =
    !!conversationId && !!wavoipVoice?.isOnCallForConversation(conversationId);
  const nvoipOnThisConversation =
    !!conversationId &&
    !!nvoipVoice?.activeCall &&
    activeVoiceCall?.provider === "nvoip" &&
    activeVoiceCall.conversationId === conversationId &&
    activeVoiceCall.agent?.id === user?.id;

  if (peerOnCall) {
    const blockedTitle =
      peerOnCall.agentName.trim().length > 0
        ? `${peerOnCall.agentName} · ${t("conversations.voiceCallInProgress")}`
        : t("conversations.voiceCallBlockedTooltip");
    return (
      <span
        className={clsx(
          "inline-flex items-center justify-center rounded-xl border border-ink-200 bg-ink-100/80 text-ink-400 dark:border-ink-700 dark:bg-ink-900/50 dark:text-ink-500",
          iconOnly || compact ? "h-8 w-8" : "px-2.5 py-2",
          className,
        )}
        title={blockedTitle}
        aria-label={blockedTitle}
      >
        <Phone className="h-4 w-4 shrink-0 opacity-50" />
      </span>
    );
  }

  if (onThisConversation || nvoipOnThisConversation) {
    const elapsed = onThisConversation ? wavoipVoice!.callElapsedSec : nvoipVoice!.activeCall!.elapsedSec;
    return (
      <span
        className={clsx(
          "inline-flex items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 font-semibold text-red-700 shadow-sm dark:border-red-400/25 dark:bg-red-950/50 dark:text-red-300",
          iconOnly || compact ? "h-8 min-w-8 px-1.5" : "px-2.5 py-2 text-xs",
          className,
        )}
        title={t("wavoip.voice.onCall")}
        role="status"
      >
        <PhoneCall className="h-4 w-4 shrink-0 animate-pulse text-red-600 dark:text-red-400" />
        <span className="font-mono text-[11px] font-bold tabular-nums">{formatCallDuration(elapsed)}</span>
      </span>
    );
  }

  const busy =
    !!wavoipVoice?.activeCall || !!nvoipVoice?.activeCall || !!threecxVoice?.activeClientCallId;

  const dial = async (provider: TelephonyProviderId, e?: React.MouseEvent) => {
    if (stopPropagation) {
      e?.preventDefault();
      e?.stopPropagation();
    }
    setOpen(false);
    setLoading(provider);
    setError(null);
    const dialPhone = phone.trim();
    try {
      if (provider === "wavoip") {
        if (!wavoipVoice) {
          setError(t("wavoip.voice.noDevices"));
          return;
        }
        const res = await wavoipVoice.startOutboundCall({
          phone: dialPhone,
          inboxId,
          conversationId,
          contactId,
        });
        if (!res.ok) {
          setError(res.message === "no_devices" ? t("wavoip.voice.noDevices") : res.message);
        }
      } else if (provider === "nvoip") {
        if (!nvoipVoice) {
          setError(t("nvoip.voice.notConfigured"));
          return;
        }
        const res = await nvoipVoice.startOutboundCall({
          phone: dialPhone,
          contactId,
          conversationId,
        });
        if (!res.ok) {
          setError(mapNvoipCallErrorMessage(res.message, t));
        }
      } else {
        if (!threecxVoice) {
          setError(t("threecx.voice.notConfigured"));
          return;
        }
        const res = await threecxVoice.startOutboundCall({
          phone: dialPhone,
          contactId,
          conversationId,
        });
        if (!res.ok) {
          setError(
            res.message === "no_route_points"
              ? t("threecx.voice.noRoutePoints")
              : res.message,
          );
        }
      }
    } finally {
      setLoading(null);
    }
  };

  const onMainClick = (e: React.MouseEvent) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (providers.length === 1) {
      void dial(providers[0]!, e);
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={rootRef} className={clsx("relative inline-flex flex-col items-end gap-0.5", className)}>
      <button
        type="button"
        disabled={!!loading || busy}
        onClick={onMainClick}
        title={t("telephony.call.tooltip")}
        aria-label={t("telephony.call.tooltip")}
        aria-expanded={providers.length > 1 ? open : undefined}
        className={clsx(
          "inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60",
          iconOnly || compact ? "h-8 min-w-8 px-1.5" : "px-2.5 py-2 text-xs",
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Phone className="h-4 w-4 shrink-0" />
        )}
        {!iconOnly && !compact ? t("wavoip.voice.callButton") : null}
        {providers.length > 1 && !loading ? (
          <ChevronDown className={clsx("h-3.5 w-3.5 opacity-70 transition", open && "rotate-180")} />
        ) : null}
      </button>

      {open && providers.length > 1 ? (
        <div
          className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900"
          role="menu"
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
            {t("telephony.call.chooseProvider")}
          </p>
          {providers.map((provider) => (
            <button
              key={provider}
              type="button"
              role="menuitem"
              disabled={!!loading || busy}
              onClick={(e) => void dial(provider, e)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-50 disabled:opacity-50 dark:text-ink-100 dark:hover:bg-ink-800"
            >
              <Phone className={clsx("h-4 w-4 shrink-0", PROVIDER_ACCENT[provider])} />
              <span className={PROVIDER_ACCENT[provider]}>{t(PROVIDER_LABEL_KEYS[provider])}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <span className="max-w-[10rem] truncate text-[10px] text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </div>
  );
}
