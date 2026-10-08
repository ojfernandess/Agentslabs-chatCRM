import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { useNvoipSipPhone, type NvoipSipCallStatus, type NvoipSipQueuedCall, type NvoipSipRemoteParty } from "@/hooks/useNvoipSipPhone";

type NvoipSipPhoneContextValue = {
  status: NvoipSipCallStatus;
  error: string | null;
  hangup: () => void;
  answer: () => Promise<void>;
  reject: () => void;
  placeCall: (number: string) => boolean;
  incoming: NvoipSipRemoteParty | null;
  queue: NvoipSipQueuedCall[];
  answeredAt: number | null;
  answering: boolean;
  muted: boolean;
  isInCall: boolean;
  enabled: boolean;
  toggleMute: () => void;
  sendDtmf: (tone: string) => void;
  requestCallAlerts: () => Promise<void>;
  answerQueued: (callId: string) => Promise<void>;
  rejectQueued: (callId: string) => void;
  resumeQueued: (callId: string) => Promise<void>;
};

const NvoipSipPhoneContext = createContext<NvoipSipPhoneContextValue>({
  status: "unregistered",
  error: null,
  hangup: () => {},
  answer: async () => {},
  reject: () => {},
  placeCall: () => false,
  incoming: null,
  queue: [],
  answeredAt: null,
  answering: false,
  muted: false,
  isInCall: false,
  enabled: false,
  toggleMute: () => {},
  sendDtmf: () => {},
  requestCallAlerts: async () => {},
  answerQueued: async () => {},
  rejectQueued: () => {},
  resumeQueued: async () => {},
});

export function useNvoipSipPhoneOptional() {
  return useContext(NvoipSipPhoneContext);
}

export function NvoipSipPhoneProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const { user } = useAuth();
  const voice = useNvoipVoiceOptional();
  const fromNvoip =
    (user?.organizationFeatures?.nvoip_voice ?? false) &&
    (user?.organizationFeatures?.nvoip_embedded_sip ?? false) &&
    voice?.voiceMode === "embedded_sip" &&
    !(isSuperAdminRole(user?.role ?? "") && !user?.actingOrganizationId);
  const embeddedEnabled = enabled ?? fromNvoip;

  const {
    status,
    error,
    hangup,
    answer,
    reject,
    placeCall,
    incoming,
    queue,
    answeredAt,
    answering,
    muted,
    isInCall,
    toggleMute,
    sendDtmf,
    requestCallAlerts,
    resumeQueued,
  } = useNvoipSipPhone(embeddedEnabled);

  useEffect(() => {
    if (!embeddedEnabled) return;
    const onHangup = () => hangup();
    window.addEventListener("openconduit:nvoip-sip-hangup-request", onHangup);
    return () => window.removeEventListener("openconduit:nvoip-sip-hangup-request", onHangup);
  }, [embeddedEnabled, hangup]);

  return (
    <NvoipSipPhoneContext.Provider
      value={{
        status,
        error,
        hangup,
        answer,
        reject,
        placeCall,
        incoming,
        queue,
        answeredAt,
        answering,
        muted,
        isInCall,
        enabled: embeddedEnabled,
        toggleMute,
        sendDtmf,
        requestCallAlerts,
        answerQueued: answer,
        rejectQueued: reject,
        resumeQueued,
      }}
    >
      {children}
    </NvoipSipPhoneContext.Provider>
  );
}
