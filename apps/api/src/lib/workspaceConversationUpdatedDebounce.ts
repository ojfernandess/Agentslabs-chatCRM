import type { ConversationUpdatedBroadcast } from "./workspaceHub.js";

type PendingEntry = {
  extra?: ConversationUpdatedBroadcast;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingEntry>();

function mergeConversationUpdatedExtra(
  a?: ConversationUpdatedBroadcast,
  b?: ConversationUpdatedBroadcast,
): ConversationUpdatedBroadcast | undefined {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
}

export function scheduleConversationUpdatedBroadcast(
  organizationId: string,
  conversationId: string,
  extra: ConversationUpdatedBroadcast | undefined,
  debounceMs: number,
  emit: (
    organizationId: string,
    conversationId: string,
    extra?: ConversationUpdatedBroadcast,
  ) => void,
): void {
  if (debounceMs <= 0) {
    emit(organizationId, conversationId, extra);
    return;
  }

  const key = `${organizationId}:${conversationId}`;
  const prev = pending.get(key);
  const merged = mergeConversationUpdatedExtra(prev?.extra, extra);
  if (prev) clearTimeout(prev.timer);

  const timer = setTimeout(() => {
    pending.delete(key);
    emit(organizationId, conversationId, merged);
  }, debounceMs);

  pending.set(key, { extra: merged, timer });
}

/** Testes — cancela timers pendentes. */
export function resetConversationUpdatedDebounce(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
  }
  pending.clear();
}
