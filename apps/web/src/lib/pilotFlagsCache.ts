export type PilotFlags = {
  assistantAiEnabled: boolean;
  aiPilotAccessEnabled: boolean;
};

export function pilotFlagsCacheKey(userId: string, organizationId: string | null | undefined): string {
  return `oc:pilot-flags:${organizationId ?? userId}`;
}

export function readPilotFlagsCache(key: string): PilotFlags | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PilotFlags>;
    if (typeof parsed.assistantAiEnabled !== "boolean" || typeof parsed.aiPilotAccessEnabled !== "boolean") {
      return null;
    }
    return {
      assistantAiEnabled: parsed.assistantAiEnabled,
      aiPilotAccessEnabled: parsed.aiPilotAccessEnabled,
    };
  } catch {
    return null;
  }
}

export function writePilotFlagsCache(key: string, flags: PilotFlags): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(flags));
  } catch {
    // ignore quota / private mode
  }
}
