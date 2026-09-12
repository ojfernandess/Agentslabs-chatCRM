/** UI connection states — derived from existing API responses only. */
export type WhatsappConnectionUiState =
  | "not_configured"
  | "configured_disconnected"
  | "connecting"
  | "connected"
  | "error";

export function isEvolutionApiSessionConnected(state: string, connected?: boolean): boolean {
  if (connected) return true;
  const s = state.trim().toLowerCase();
  return s === "open" || s === "connected" || s === "online";
}

export function deriveEvolutionApiUiState(opts: {
  configured: boolean;
  connected: boolean;
  state: string;
  hasError?: boolean;
}): WhatsappConnectionUiState {
  if (!opts.configured) return "not_configured";
  if (opts.hasError) return "error";
  if (isEvolutionApiSessionConnected(opts.state, opts.connected)) return "connected";
  const s = opts.state.toLowerCase();
  if (s === "connecting" || s === "pairing" || s.includes("qr")) return "connecting";
  return "configured_disconnected";
}

export function deriveEvolutionGoUiState(opts: {
  hasInstance: boolean;
  status: {
    connected: boolean;
    loggedIn: boolean;
    unreachable?: boolean;
    instanceMissing?: boolean;
  } | null;
  hasError?: boolean;
}): WhatsappConnectionUiState {
  if (!opts.hasInstance || opts.status?.instanceMissing) return "not_configured";
  if (opts.hasError) return "error";
  if (!opts.status) return "configured_disconnected";
  if (opts.status.unreachable) return "configured_disconnected";
  if (opts.status.loggedIn) return "connected";
  if (opts.status.connected) return "connecting";
  return "configured_disconnected";
}

export const CONNECTION_STATE_LABELS: Record<
  WhatsappConnectionUiState,
  { pt: string; en: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  not_configured: { pt: "Não configurado", en: "Not configured", tone: "neutral" },
  configured_disconnected: {
    pt: "Configurado / desconectado",
    en: "Configured / disconnected",
    tone: "warning",
  },
  connecting: { pt: "Conectando", en: "Connecting", tone: "info" },
  connected: { pt: "Conectado", en: "Connected", tone: "success" },
  error: { pt: "Erro", en: "Error", tone: "danger" },
};
