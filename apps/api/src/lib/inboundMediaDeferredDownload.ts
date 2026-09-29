import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import { persistEvolutionInboundMediaAsLocalUrl } from "./evolutionInboundMedia.js";
import { persistEvolutionGoInboundMediaAsLocalUrl } from "./evolutionGoInboundMedia.js";
import { persistMetaInboundMediaAsLocalUrl } from "./metaInboundMedia.js";
import { resolveInboxWhatsappCredentials } from "./inboxWhatsappConfig.js";
import {
  broadcastConversationMessageUpdated,
  serializeMessageForWorkspaceWs,
} from "./workspaceMessageBroadcast.js";
import { resolveMessageReplyForApi } from "./messageReply.js";

export type DeferredInboundMediaJob = {
  organizationId: string;
  inboxId: string;
  messageId: string;
  conversationId: string;
  contactName: string;
  whatsappProvider: string;
  msgType: string;
  metaMediaId?: string;
  metaFileName?: string;
  mediaTypeHint?: string | null;
  evolutionWebMessage?: Record<string, unknown>;
  log: FastifyBaseLogger;
};

async function downloadDeferredMedia(
  job: DeferredInboundMediaJob,
): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const { whatsappProvider, msgType } = job;

  if (
    whatsappProvider === "evolution" &&
    job.evolutionWebMessage &&
    ["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(msgType)
  ) {
    const tryPersist = () =>
      persistEvolutionInboundMediaAsLocalUrl({
        organizationId: job.organizationId,
        evolutionWebMessage: job.evolutionWebMessage!,
      });
    let local = await tryPersist();
    if (!local) {
      await new Promise((r) => setTimeout(r, 1200));
      local = await tryPersist();
    }
    return local;
  }

  if (
    whatsappProvider === "evolution_go" &&
    job.evolutionWebMessage &&
    typeof job.evolutionWebMessage.base64 === "string" &&
    job.evolutionWebMessage.base64.trim()
  ) {
    const mimetype =
      typeof job.evolutionWebMessage.mimetype === "string" && job.evolutionWebMessage.mimetype.trim()
        ? job.evolutionWebMessage.mimetype.trim()
        : job.mediaTypeHint ?? "application/octet-stream";
    const fileName =
      typeof job.evolutionWebMessage.fileName === "string" && job.evolutionWebMessage.fileName.trim()
        ? job.evolutionWebMessage.fileName.trim()
        : undefined;
    return persistEvolutionGoInboundMediaAsLocalUrl({
      base64: job.evolutionWebMessage.base64.trim(),
      mimetype,
      fileName,
    });
  }

  if (
    (whatsappProvider === "meta" || whatsappProvider === "360dialog") &&
    job.metaMediaId &&
    ["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(msgType)
  ) {
    const inboxRow = await prisma.inbox.findFirst({
      where: { id: job.inboxId, organizationId: job.organizationId },
      select: {
        channelConfig: true,
        channelType: true,
        whatsappPhoneNumberId: true,
        isDefault: true,
      },
    });
    const inboxCreds = inboxRow
      ? await resolveInboxWhatsappCredentials(job.organizationId, inboxRow)
      : null;
    const accessToken = decrypt(inboxCreds?.whatsappApiKey) ?? "";
    if (!accessToken) return null;
    const tryPersist = () =>
      persistMetaInboundMediaAsLocalUrl({
        accessToken,
        mediaId: job.metaMediaId!,
        mimeTypeHint: job.mediaTypeHint ?? undefined,
        fileName: job.metaFileName,
      });
    let local = await tryPersist();
    if (!local) {
      await new Promise((r) => setTimeout(r, 800));
      local = await tryPersist();
    }
    return local;
  }

  return null;
}

/** Download em background + `message.updated` WS com mediaUrl (Fase 4). */
export function scheduleDeferredInboundMediaDownload(job: DeferredInboundMediaJob): void {
  void (async () => {
    const local = await downloadDeferredMedia(job);
    if (!local) {
      job.log.warn(
        { organizationId: job.organizationId, messageId: job.messageId, type: job.msgType },
        "Deferred inbound media download failed",
      );
      return;
    }
    const updated = await prisma.message.update({
      where: { id: job.messageId },
      data: { mediaUrl: local.mediaUrl, mediaType: local.mediaType },
      include: { replyTo: true },
    });
    const payload = serializeMessageForWorkspaceWs(updated, {
      contactName: job.contactName,
      replyTo: resolveMessageReplyForApi(updated, job.contactName),
    });
    broadcastConversationMessageUpdated(job.organizationId, job.conversationId, {
      id: payload.id,
      status: payload.status,
      body: payload.body,
      mediaUrl: payload.mediaUrl,
      mediaType: payload.mediaType,
    });
  })().catch((err) => {
    job.log.warn({ err, messageId: job.messageId }, "Deferred inbound media download error");
  });
}

export function inboundMessageNeedsDeferredMediaDownload(input: {
  deferEnabled: boolean;
  whatsappProvider: string;
  msgType: string;
  metaMediaId?: string;
  evolutionWebMessage?: unknown;
  existingMediaUrl?: string | null;
  audioTranscriptionEnabled?: boolean;
  imageTranscriptionEnabled?: boolean;
}): boolean {
  if (!input.deferEnabled) return false;
  if (input.existingMediaUrl?.trim()) return false;
  if (input.msgType === "AUDIO") return false;
  if (input.msgType === "IMAGE" && input.imageTranscriptionEnabled) return false;
  if (!["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(input.msgType)) return false;
  if (input.whatsappProvider === "meta" || input.whatsappProvider === "360dialog") {
    return Boolean(input.metaMediaId);
  }
  if (input.whatsappProvider === "evolution" || input.whatsappProvider === "evolution_go") {
    return Boolean(input.evolutionWebMessage);
  }
  return false;
}
