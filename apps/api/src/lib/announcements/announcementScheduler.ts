import type { FastifyBaseLogger } from "fastify";
import { queueAnnouncementFanout } from "./announcementFanout.js";
import { publishDueAnnouncements } from "./announcementService.js";

let ticking = false;

export async function runAnnouncementSchedulerTick(log?: FastifyBaseLogger): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const notifyIds = await publishDueAnnouncements();
    for (const id of notifyIds) queueAnnouncementFanout(id);
  } catch (err) {
    log?.error({ err }, "announcement scheduler tick failed");
  } finally {
    ticking = false;
  }
}
