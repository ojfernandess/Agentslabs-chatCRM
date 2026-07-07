import { TurnstileWidget } from "@/components/TurnstileWidget";
import { useTurnstileConfig } from "@/hooks/useTurnstileConfig";

type Props = {
  onToken: (token: string | null) => void;
  resetSignal?: number;
};

export function AuthTurnstileField({ onToken, resetSignal = 0 }: Props) {
  const { config, turnstileActive } = useTurnstileConfig();
  if (!turnstileActive || !config?.siteKey) return null;
  return <TurnstileWidget siteKey={config.siteKey} onToken={onToken} resetSignal={resetSignal} />;
}

export function useAuthTurnstileGate() {
  const { turnstileActive, loading } = useTurnstileConfig();
  return {
    turnstileActive,
    loading,
    isBlocked: (token: string | null) => turnstileActive && !token,
  };
}
