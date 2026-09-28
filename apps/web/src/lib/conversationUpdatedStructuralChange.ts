import type { ConversationUpdatedDetail } from "@/hooks/useDebouncedConversationUpdated";

/** True when conversation metadata changed (status, assignee, inbox, etc.) — not a plain new message. */
export function conversationUpdateHasStructuralChange(
  detail?: ConversationUpdatedDetail,
): boolean {
  if (!detail) return false;
  return (
    Boolean(detail.status) ||
    detail.assignedToId !== undefined ||
    detail.teamId !== undefined ||
    Boolean(detail.inboxId) ||
    detail.awaitingHumanHandoff !== undefined ||
    detail.agentBotTriageActive !== undefined
  );
}
