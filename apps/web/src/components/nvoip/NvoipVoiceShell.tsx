import { type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { NvoipVoiceProvider } from "@/contexts/NvoipVoiceContext";
import { NvoipSipPhoneProvider } from "@/contexts/NvoipSipPhoneContext";
import { NvoipActiveCallBar } from "@/components/nvoip/NvoipActiveCallBar";
import { NvoipTrunkPicker } from "@/components/nvoip/NvoipTrunkPicker";

export function NvoipVoiceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.organizationFeatures?.nvoip_voice ?? false;
  const embeddedSip = user?.organizationFeatures?.nvoip_embedded_sip ?? false;

  if (!enabled) return <>{children}</>;

  const chrome = (
    <>
      {children}
      <NvoipTrunkPicker />
      <NvoipActiveCallBar />
    </>
  );

  return (
    <NvoipVoiceProvider>
      {embeddedSip ? <NvoipSipPhoneProvider>{chrome}</NvoipSipPhoneProvider> : chrome}
    </NvoipVoiceProvider>
  );
}
