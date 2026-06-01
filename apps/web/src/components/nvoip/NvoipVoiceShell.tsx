import { type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { NvoipVoiceProvider } from "@/contexts/NvoipVoiceContext";
import { NvoipActiveCallBar } from "@/components/nvoip/NvoipActiveCallBar";

export function NvoipVoiceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.organizationFeatures?.nvoip_voice ?? false;

  if (!enabled) return <>{children}</>;

  return (
    <NvoipVoiceProvider>
      {children}
      <NvoipActiveCallBar />
    </NvoipVoiceProvider>
  );
}
