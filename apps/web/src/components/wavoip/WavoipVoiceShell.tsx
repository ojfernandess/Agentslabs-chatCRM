import { type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { WavoipVoiceProvider } from "@/contexts/WavoipVoiceContext";
import { WavoipIncomingCallModal } from "@/components/wavoip/WavoipIncomingCallModal";
import { WavoipActiveCallBar } from "@/components/wavoip/WavoipActiveCallBar";

/** Voice SDK + incoming/active call UI for authenticated workspace. */
export function WavoipVoiceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.organizationFeatures?.wavoip_voice !== false;

  if (!enabled) return <>{children}</>;

  return (
    <WavoipVoiceProvider>
      {children}
      <WavoipIncomingCallModal />
      <WavoipActiveCallBar />
    </WavoipVoiceProvider>
  );
}
