import { useEffect, useState } from "react";

export const WORKSPACE_WS_CONNECTION_EVENT = "openconduit:workspace-ws-connection";

export function publishWorkspaceWebSocketConnected(connected: boolean): void {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_WS_CONNECTION_EVENT, {
      detail: { connected },
    }),
  );
}

/** True quando o WebSocket do workspace está ligado (OPEN). */
export function useWorkspaceWebSocketConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const onConnection = (e: Event) => {
      const detail = (e as CustomEvent<{ connected?: boolean }>).detail;
      setConnected(Boolean(detail?.connected));
    };
    window.addEventListener(WORKSPACE_WS_CONNECTION_EVENT, onConnection);
    return () => window.removeEventListener(WORKSPACE_WS_CONNECTION_EVENT, onConnection);
  }, []);

  return connected;
}
