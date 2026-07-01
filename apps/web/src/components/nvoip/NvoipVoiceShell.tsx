import { type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { NvoipVoiceProvider, useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { NvoipSipPhoneProvider } from "@/contexts/NvoipSipPhoneContext";
import { NvoipActiveCallBar } from "@/components/nvoip/NvoipActiveCallBar";
import { NvoipTrunkPicker } from "@/components/nvoip/NvoipTrunkPicker";

function NvoipEmbeddedSipGate({ children }: { children: ReactNode }) {
  const voice = useNvoipVoiceOptional();
  if (voice?.voiceMode !== "embedded_sip") return <>{children}</>;
  return <NvoipSipPhoneProvider>{children}</NvoipSipPhoneProvider>;
}

export function NvoipVoiceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.organizationFeatures?.nvoip_voice ?? false;

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
      <NvoipEmbeddedSipGate>{chrome}</NvoipEmbeddedSipGate>
    </NvoipVoiceProvider>
  );
}
