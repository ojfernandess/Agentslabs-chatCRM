import { broadcastToOrganization } from "../workspaceHub.js";
import { listAudienceOrganizationIds, targetsForAnnouncement } from "./announcementService.js";

/** Dispara o fan-out depois da resposta HTTP. Um evento por organização, no WebSocket já existente. */
export function queueAnnouncementFanout(announcementId: string): void {
  setImmediate(() => {
    void fanoutAnnouncement(announcementId).catch(() => {
      /* o mural não pode derrubar o processo de atendimento */
    });
  });
}

export async function fanoutAnnouncement(announcementId: string): Promise<void> {
  const targets = await targetsForAnnouncement(announcementId);
  if (!targets) return;
  const organizationIds = await listAudienceOrganizationIds(targets);
  const chunkSize = 40;
  for (let index = 0; index < organizationIds.length; index += chunkSize) {
    for (const organizationId of organizationIds.slice(index, index + chunkSize)) {
      broadcastToOrganization(organizationId, {
        type: "announcement.published",
        announcementId,
      });
    }
    if (index + chunkSize < organizationIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
