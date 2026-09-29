export const WORKSPACE_SUBSCRIBE_CONVERSATIONS_EVENT = "openconduit:workspace-subscribe-conversations";
export const WORKSPACE_UNSUBSCRIBE_CONVERSATIONS_EVENT = "openconduit:workspace-unsubscribe-conversations";

export function subscribeWorkspaceConversations(conversationIds: string[]): void {
  const ids = conversationIds.map((id) => id.trim()).filter(Boolean);
  if (!ids.length) return;
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_SUBSCRIBE_CONVERSATIONS_EVENT, { detail: { conversationIds: ids } }),
  );
}

export function unsubscribeWorkspaceConversations(conversationIds?: string[]): void {
  const ids = conversationIds?.map((id) => id.trim()).filter(Boolean);
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_UNSUBSCRIBE_CONVERSATIONS_EVENT, {
      detail: { conversationIds: ids },
    }),
  );
}
