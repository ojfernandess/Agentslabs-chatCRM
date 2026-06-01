import { type ReactNode, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { WavoipVoiceProvider } from "@/contexts/WavoipVoiceContext";
import { WavoipIncomingCallModal } from "@/components/wavoip/WavoipIncomingCallModal";
import { WavoipActiveCallBar } from "@/components/wavoip/WavoipActiveCallBar";

const QR_PAIRING_PATH = /^\/settings\/wavoip\/[^/]+\/qr\/?$/;

/** Voice SDK + incoming/active call UI for authenticated workspace. */
export function WavoipVoiceShell({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const location = useLocation();
  const enabled = user?.organizationFeatures?.wavoip_voice ?? false;
  const isQrPairingRoute = QR_PAIRING_PATH.test(location.pathname);
  const refreshedFeaturesRef = useRef(false);

  // Após deploy/migração a flag pode já estar activa na API mas a sessão ainda ter o mapa antigo.
  useEffect(() => {
    if (!user || enabled || refreshedFeaturesRef.current) return;
    refreshedFeaturesRef.current = true;
    void refreshUser();
  }, [user, enabled, refreshUser]);

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
