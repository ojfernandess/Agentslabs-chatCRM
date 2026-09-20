const KEY = "openconduit_presence_session_key";
export const PRESENCE_SHUTDOWN_EVENT = "openconduit:presence-shutdown";

let clientPresenceShutdown = false;

export function isPresenceClientShutdown(): boolean {
  return clientPresenceShutdown;
}

export function resetPresenceClientShutdown(): void {
  clientPresenceShutdown = false;
}

export function getOrCreatePresenceSessionKey(): string {
  let key = sessionStorage.getItem(KEY);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(KEY, key);
  }
  return key;
}

export function getPresenceSessionKeyOrNull(): string | null {
  return sessionStorage.getItem(KEY);
}

/** Para heartbeats/reconnects antes de encerrar sessão no servidor (logout). */
export function shutdownPresenceClient(token?: string): void {
  if (clientPresenceShutdown) return;
  clientPresenceShutdown = true;
  window.dispatchEvent(
    new CustomEvent(PRESENCE_SHUTDOWN_EVENT, { detail: { token: token ?? null } }),
  );
}

/** Otimização ao fechar aba — não substitui expiração por heartbeat. */
export function sendPresenceSessionEndKeepalive(token: string): void {
  const sessionKey = getPresenceSessionKeyOrNull();
  if (!sessionKey) return;
  void fetch("/api/v1/auth/me/presence/session-end", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionKey }),
    keepalive: true,
  }).catch(() => {
    /* ignore */
  });
}

/** Encerra sessão de presença no servidor antes de limpar o token local. */
export async function notifyAuthLogoutBeforeClearToken(token: string): Promise<void> {
  shutdownPresenceClient(token);
  sendPresenceSessionEndKeepalive(token);

  const sessionKey = getPresenceSessionKeyOrNull();
  try {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(sessionKey ? { sessionKey } : {}),
    });
  } catch {
    /* ignore — estado local será limpo na mesma */
  }
}
