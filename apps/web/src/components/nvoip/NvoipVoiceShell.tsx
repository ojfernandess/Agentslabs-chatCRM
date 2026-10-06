import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { api } from "@/lib/api";
import { NvoipVoiceProvider, useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { NvoipSipPhoneProvider } from "@/contexts/NvoipSipPhoneContext";
import { NvoipActiveCallBar } from "@/components/nvoip/NvoipActiveCallBar";
import { NvoipSoftphonePanel } from "@/components/nvoip/NvoipSoftphonePanel";
import { NvoipTrunkPicker } from "@/components/nvoip/NvoipTrunkPicker";

function StandaloneSipShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const refresh = useCallback(async () => {
    if (isSuperAdminRole(user?.role ?? "") && !user?.actingOrganizationId) {
      setEnabled(false);
      return;
    }
    try {
      const creds = await api.get<{ wssUrl?: string }>("/sip/credentials");
      setEnabled(Boolean(creds.wssUrl?.trim()));
    } catch {
      setEnabled(false);
    }
  }, [user?.actingOrganizationId, user?.role]);

  useEffect(() => {
    void refresh();
    const onRefresh = () => void refresh();
    window.addEventListener("openconduit:nvoip-sip-refresh", onRefresh);
    return () => window.removeEventListener("openconduit:nvoip-sip-refresh", onRefresh);
  }, [refresh]);

  return (
    <NvoipSipPhoneProvider enabled={enabled}>
      {children}
      <NvoipSoftphonePanel />
    </NvoipSipPhoneProvider>
  );
}

function NvoipEmbeddedSipGate({ children }: { children: ReactNode }) {
  const voice = useNvoipVoiceOptional();
  if (voice?.voiceMode !== "embedded_sip") return <>{children}</>;
  return <NvoipSipPhoneProvider>{children}</NvoipSipPhoneProvider>;
}

export function NvoipVoiceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const nvoipEnabled = user?.organizationFeatures?.nvoip_voice ?? false;
  const embeddedEnabled = user?.organizationFeatures?.nvoip_embedded_sip ?? false;

  if (!nvoipEnabled && embeddedEnabled) {
    return <StandaloneSipShell>{children}</StandaloneSipShell>;
  }

  if (!nvoipEnabled) return <>{children}</>;

  const chrome = (
    <>
      {children}
      <NvoipTrunkPicker />
      <NvoipActiveCallBar />
      <NvoipSoftphonePanel />
    </>
  );

  return (
    <NvoipVoiceProvider>
      <NvoipEmbeddedSipGate>{chrome}</NvoipEmbeddedSipGate>
    </NvoipVoiceProvider>
  );
}
