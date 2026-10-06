import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { useNvoipSipPhone, type NvoipSipCallStatus, type NvoipSipRemoteParty } from "@/hooks/useNvoipSipPhone";

type NvoipSipPhoneContextValue = {
  status: NvoipSipCallStatus;
  error: string | null;
  hangup: () => void;
  answer: () => Promise<void>;
  reject: () => void;
  incoming: NvoipSipRemoteParty | null;
  answeredAt: number | null;
  answering: boolean;
  isInCall: boolean;
  enabled: boolean;
};

const NvoipSipPhoneContext = createContext<NvoipSipPhoneContextValue>({
  status: "unregistered",
  error: null,
  hangup: () => {},
  answer: async () => {},
  reject: () => {},
  incoming: null,
  answeredAt: null,
  answering: false,
  isInCall: false,
  enabled: false,
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

  const { status, error, hangup, answer, reject, incoming, answeredAt, answering, isInCall } =
    useNvoipSipPhone(embeddedEnabled);

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
        incoming,
        answeredAt,
        answering,
        isInCall,
        enabled: embeddedEnabled,
      }}
    >
      {children}
    </NvoipSipPhoneContext.Provider>
  );
}
