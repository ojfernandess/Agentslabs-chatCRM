import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { useNvoipSipPhone, type NvoipSipCallStatus } from "@/hooks/useNvoipSipPhone";

type NvoipSipPhoneContextValue = {
  status: NvoipSipCallStatus;
  error: string | null;
  hangup: () => void;
  isInCall: boolean;
  enabled: boolean;
};

const NvoipSipPhoneContext = createContext<NvoipSipPhoneContextValue>({
  status: "unregistered",
  error: null,
  hangup: () => {},
  isInCall: false,
  enabled: false,
});

export function useNvoipSipPhoneOptional() {
  return useContext(NvoipSipPhoneContext);
}

export function NvoipSipPhoneProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const embeddedEnabled =
    (user?.organizationFeatures?.nvoip_voice ?? false) &&
    (user?.organizationFeatures?.nvoip_embedded_sip ?? false) &&
    !(isSuperAdminRole(user?.role ?? "") && !user?.actingOrganizationId);

  const { status, error, hangup, isInCall } = useNvoipSipPhone(embeddedEnabled);

  useEffect(() => {
    if (!embeddedEnabled) return;
    const onHangup = () => hangup();
    window.addEventListener("openconduit:nvoip-sip-hangup-request", onHangup);
    return () => window.removeEventListener("openconduit:nvoip-sip-hangup-request", onHangup);
  }, [embeddedEnabled, hangup]);

  return (
    <NvoipSipPhoneContext.Provider
      value={{ status, error, hangup, isInCall, enabled: embeddedEnabled }}
    >
      {children}
    </NvoipSipPhoneContext.Provider>
  );
}
