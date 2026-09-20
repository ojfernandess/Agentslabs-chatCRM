const KEY = "openconduit_presence_session_key";

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
