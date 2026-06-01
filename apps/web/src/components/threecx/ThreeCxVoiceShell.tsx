import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ThreeCxVoiceProvider } from "@/contexts/ThreeCxVoiceContext";

export function ThreeCxVoiceShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = user?.organizationFeatures?.threecx_voice ?? false;
  if (!enabled) return <>{children}</>;
  return <ThreeCxVoiceProvider>{children}</ThreeCxVoiceProvider>;
}
