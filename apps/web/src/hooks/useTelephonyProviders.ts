import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWavoipVoiceOptional } from "@/contexts/WavoipVoiceContext";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { useThreeCxVoiceOptional } from "@/contexts/ThreeCxVoiceContext";

export type TelephonyProviderId = "wavoip" | "nvoip" | "threecx";

export function useTelephonyProviders() {
  const { user } = useAuth();
  const wavoipVoice = useWavoipVoiceOptional();
  const nvoipVoice = useNvoipVoiceOptional();
  const threecxVoice = useThreeCxVoiceOptional();

  const wavoipEnabled = user?.organizationFeatures?.wavoip_voice ?? false;
  const nvoipEnabled = user?.organizationFeatures?.nvoip_voice ?? false;
  const threecxEnabled = user?.organizationFeatures?.threecx_voice ?? false;

  const wavoipCan = wavoipEnabled && (wavoipVoice?.canPlaceCalls ?? false);
  const nvoipCan = nvoipEnabled && (nvoipVoice?.canPlaceCalls ?? false);
  const threecxCan = threecxEnabled && (threecxVoice?.canPlaceCalls ?? false);

  const providers = useMemo(() => {
    const list: TelephonyProviderId[] = [];
    if (wavoipCan) list.push("wavoip");
    if (threecxCan) list.push("threecx");
    if (nvoipCan) list.push("nvoip");
    return list;
  }, [wavoipCan, nvoipCan, threecxCan]);

  return {
    providers,
    wavoipVoice,
    nvoipVoice,
    threecxVoice,
    wavoipCan,
    nvoipCan,
    threecxCan,
  };
}
