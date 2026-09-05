import { prisma } from "../db.js";
import { broadcastContactTagsUpdated } from "./workspaceHub.js";

/** WS refresh para lista split-view quando etiquetas do contacto mudam. */
export async function broadcastContactTagChange(
  organizationId: string,
  contactId: string,
  conversationId?: string | null,
): Promise<void> {
  const ids = new Set<string>();
  if (conversationId?.trim()) ids.add(conversationId.trim());
  const rows = await prisma.conversation.findMany({
    where: { organizationId, contactId, deletedAt: null },
    select: { id: true },
  });
  for (const { id } of rows) ids.add(id);
  if (ids.size === 0) return;
  broadcastContactTagsUpdated(organizationId, [...ids]);
}
