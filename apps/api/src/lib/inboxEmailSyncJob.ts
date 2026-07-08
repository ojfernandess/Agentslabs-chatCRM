import type { FastifyBaseLogger } from "fastify";
import { InboxChannelType, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  isInboxEmailReceiveConfiguredFromChannelConfig,
  readEmailImapLastUid,
  resolveInboxEmailImapCredentials,
} from "./inboxEmailConfig.js";
import { syncInboxEmailViaImap } from "./inboxEmailImap.js";

const syncingInboxIds = new Set<string>();

export async function runInboxEmailSyncTick(log: FastifyBaseLogger): Promise<void> {
  const inboxes = await prisma.inbox.findMany({
    where: { channelType: InboxChannelType.EMAIL },
    select: {
      id: true,
      organizationId: true,
      channelConfig: true,
      organization: { select: { isActive: true } },
    },
    take: 50,
    orderBy: { updatedAt: "asc" },
  });

  for (const inbox of inboxes) {
    if (!inbox.organization.isActive) continue;
    if (!isInboxEmailReceiveConfiguredFromChannelConfig(inbox.channelConfig)) continue;
    if (syncingInboxIds.has(inbox.id)) continue;

    syncingInboxIds.add(inbox.id);
    try {
      const result = await syncInboxEmailViaImap({
        organizationId: inbox.organizationId,
        inboxId: inbox.id,
        channelConfig: inbox.channelConfig,
        log,
      });

      const prevUid = readEmailImapLastUid(inbox.channelConfig);
      if (result.lastUid > prevUid || result.processed > 0 || result.error || result.skipped > 0) {
        const base =
          inbox.channelConfig && typeof inbox.channelConfig === "object" && !Array.isArray(inbox.channelConfig)
            ? { ...(inbox.channelConfig as Record<string, unknown>) }
            : {};
        base.emailImapLastUid = result.lastUid;
        base.emailImapLastSyncAt = new Date().toISOString();
        if (result.error) base.emailImapLastError = result.error;
        else delete base.emailImapLastError;

        await prisma.inbox.update({
          where: { id: inbox.id },
          data: { channelConfig: base as Prisma.InputJsonValue },
        });
      }

      if (result.processed > 0) {
        log.info(
          {
            inboxId: inbox.id,
            organizationId: inbox.organizationId,
            processed: result.processed,
            skipped: result.skipped,
            lastUid: result.lastUid,
          },
          "email IMAP sync imported messages",
        );
      } else if (result.error) {
        log.warn(
          { inboxId: inbox.id, organizationId: inbox.organizationId, error: result.error },
          "email IMAP sync error",
        );
      }
    } catch (err) {
      log.warn({ err, inboxId: inbox.id }, "email IMAP sync tick failed for inbox");
    } finally {
      syncingInboxIds.delete(inbox.id);
    }
  }
}

export async function syncInboxEmailNow(options: {
  organizationId: string;
  inboxId: string;
  log: FastifyBaseLogger;
}): Promise<{ processed: number; skipped: number; error?: string }> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: options.inboxId, organizationId: options.organizationId, channelType: InboxChannelType.EMAIL },
    select: { id: true, channelConfig: true },
  });
  if (!inbox) {
    throw new Error("Inbox not found");
  }
  if (!resolveInboxEmailImapCredentials(inbox.channelConfig)) {
    throw new Error("Email IMAP is not configured on this inbox");
  }

  const result = await syncInboxEmailViaImap({
    organizationId: options.organizationId,
    inboxId: inbox.id,
    channelConfig: inbox.channelConfig,
    log: options.log,
  });

  const prevUid = readEmailImapLastUid(inbox.channelConfig);
  if (result.lastUid > prevUid || result.processed > 0 || result.error || result.skipped > 0) {
    const base =
      inbox.channelConfig && typeof inbox.channelConfig === "object" && !Array.isArray(inbox.channelConfig)
        ? { ...(inbox.channelConfig as Record<string, unknown>) }
        : {};
    base.emailImapLastUid = result.lastUid;
    base.emailImapLastSyncAt = new Date().toISOString();
    if (result.error) base.emailImapLastError = result.error;
    else delete base.emailImapLastError;

    await prisma.inbox.update({
      where: { id: inbox.id },
      data: { channelConfig: base as Prisma.InputJsonValue },
    });
  }

  return { processed: result.processed, skipped: result.skipped, error: result.error };
}
