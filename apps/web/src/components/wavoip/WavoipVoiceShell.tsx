import { type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { WavoipVoiceProvider } from "@/contexts/WavoipVoiceContext";
import { WavoipIncomingCallModal } from "@/components/wavoip/WavoipIncomingCallModal";
import { WavoipActiveCallBar } from "@/components/wavoip/WavoipActiveCallBar";

const QR_PAIRING_PATH = /^\/settings\/wavoip\/[^/]+\/qr\/?$/;

/** Voice SDK + incoming/active call UI for authenticated workspace. */
export function WavoipVoiceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const enabled = user?.organizationFeatures?.wavoip_voice !== false;
  const isQrPairingRoute = QR_PAIRING_PATH.test(location.pathname);

  // Avoid duplicate WebSocket sessions with the QR pairing page (same device token).
  if (!enabled || isQrPairingRoute) return <>{children}</>;

  return (
    <WavoipVoiceProvider>
      {children}
      <WavoipIncomingCallModal />
      <WavoipActiveCallBar />
    </WavoipVoiceProvider>
  );
}
