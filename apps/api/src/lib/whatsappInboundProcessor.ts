import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { normalizePhoneE164 } from "@openconduit/shared";
import { appendTimelineEvent } from "./timeline.js";
import { config } from "../config.js";
import {
  awaitInboundTranscriptionGate,
  resolveWaitForInboundTranscription,
  startInboundMediaTranscription,
} from "./inboundTranscriptionPipeline.js";
import { dispatchAgentBotWebhook } from "./agentBotWebhook.js";
import { getAgentBotDispatchContextForInbox } from "./agentBotTriage.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { updateLedgerDeliveryStatus } from "./messageBillingLedger.js";
import { sanitizeProviderErrorMessage } from "./providerErrorMessage.js";
import { ensureConversationForChannelInbox } from "./conversationRouting.js";
import { persistEvolutionInboundMediaAsLocalUrl } from "./evolutionInboundMedia.js";
import { persistEvolutionGoInboundMediaAsLocalUrl } from "./evolutionGoInboundMedia.js";
import { persistMetaInboundMediaAsLocalUrl } from "./metaInboundMedia.js";
import { decrypt } from "./encryption.js";
import { resolveInboxWhatsappCredentials } from "./inboxWhatsappConfig.js";
import { findContactByInboundPhone } from "./contactPhoneMatch.js";
import { syncContactProfilePicture } from "./contactProfilePictureResolve.js";
import {
  applyContactMessageReaction,
  loadMessageReactionsForApi,
} from "./messageReactions.js";
import {
  messageReplyToInclude,
  resolveInboundReplyTarget,
  resolveMessageReplyForApi,
} from "./messageReply.js";
import { resolveConversationBellNotify } from "./conversationBellScope.js";
import {
  broadcastConversationMessageReactionsUpdated,
  broadcastConversationMessageUpdated,
  notifyConversationNewMessage,
  serializeMessageForWorkspaceWs,
} from "./workspaceMessageBroadcast.js";
import { scheduleIntelligentTaggingDuringConversation } from "./intelligent-tagging/service.js";
import {
  completeDeferredMessageTrace,
  deferMessageTraceFinish,
  finishMessageTrace,
  maybeStartMessageTrace,
  runWithTraceHandle,
} from "./message-processing-monitor/service.js";
import { getCachedAutoTagRules, runWithRequestLookupCache } from "./requestLookupCache.js";
import {
  inboundMessageNeedsDeferredMediaDownload,
  scheduleDeferredInboundMediaDownload,
} from "./inboundMediaDeferredDownload.js";
import type { ActiveTraceHandle } from "./message-processing-monitor/traceContext.js";
import { recordWhatsappInboundWebhook } from "./whatsappWebhookRouting.js";
import { isMetaCloudWebhookPayload } from "./metaWebhookPayload.js";
import type {
  ContactSyncPatch,
  IncomingMessage,
  ReactionUpdate,
  StatusUpdate,
} from "../providers/types.js";

export type WhatsAppWebhookTarget = { inboxId: string; whatsappProvider: string };

export type ProcessWhatsAppWebhookScope = "all" | "status_reactions" | "messages_and_contacts";

export type ProcessWhatsAppWebhookEventsInput = {
  app: FastifyInstance;
  organizationId: string;
  target: WhatsAppWebhookTarget;
  body: unknown;
  messages: IncomingMessage[];
  statusUpdates: StatusUpdate[];
  reactionUpdates: ReactionUpdate[];
  contactSync?: ContactSyncPatch[];
  scope: ProcessWhatsAppWebhookScope;
};

export async function processWhatsAppWebhookEvents(
  input: ProcessWhatsAppWebhookEventsInput,
): Promise<number> {
  const { app, organizationId, target, body, scope } = input;
  const messages = scope === "status_reactions" ? [] : input.messages;
  const contactSync = scope === "status_reactions" ? undefined : input.contactSync;
  const statusUpdates = scope === "messages_and_contacts" ? [] : input.statusUpdates;
  const reactionUpdates = scope === "messages_and_contacts" ? [] : input.reactionUpdates;
  let processedWebhookEvents = 0;
  for (const patch of contactSync ?? []) {
    try {
      const phone = normalizePhoneE164(patch.phone);
      if (!phone) continue;
      let existing = await findContactByInboundPhone(prisma, organizationId, phone, null);
      if (!existing) {
        const dn = patch.waDisplayName?.trim() || phone;
        existing = await prisma.contact.create({
          data: {
            organizationId,
            phone,
            name: dn,
            waId: phone,
            profilePictureUrl: patch.profilePictureUrl ?? undefined,
          },
        });
      }
      const data: {
        profilePictureUrl?: string | null;
        name?: string;
      } = {};
      if (patch.profilePictureUrl !== undefined && patch.profilePictureUrl !== null) {
        data.profilePictureUrl = patch.profilePictureUrl;
      } else if (patch.profilePictureUrl === null) {
        data.profilePictureUrl = null;
      }
      const dn = patch.waDisplayName?.trim();
      if (dn) {
        const nameDigits = existing.name.replace(/\D/g, "");
        const phoneDigits = phone.replace(/\D/g, "");
        const nameLooksLikePhone = nameDigits.length >= 7 && nameDigits === phoneDigits;
        if (nameLooksLikePhone || existing.name === phone || existing.name === "Desconhecido") {
          data.name = dn;
        }
      }
      if (Object.keys(data).length > 0) {
        await prisma.contact.update({ where: { id: existing.id }, data });
      }
      if (!existing.isGroupChat) {
        void syncContactProfilePicture({
          organizationId,
          contactId: existing.id,
          phone: existing.phone,
          profilePictureUrl: patch.profilePictureUrl ?? existing.profilePictureUrl,
          preferredInboxId: target.inboxId,
        }).catch(() => {});
      }
    } catch (err) {
      app.log.error(err, "Error applying contact sync from webhook");
    }
  }

  let channelSettings = await prisma.settings.findUnique({
    where: { organizationId },
  });
  if (!channelSettings) {
    channelSettings = await prisma.settings.create({
      data: { organizationId },
    });
  }
  const targetInboxAgentCtx = await getAgentBotDispatchContextForInbox(organizationId, target.inboxId);
  const useAgentBotOnInbox = Boolean(targetInboxAgentCtx);

  const whatsappGroupsEnabled = await isOrganizationFeatureEnabled(organizationId, "whatsapp_groups");

  for (const msg of messages) {
    let msgMonitor: ActiveTraceHandle | null = null;
    try {
      if (msg.waMessageId) {
        const duplicate = await prisma.message.findFirst({
          where: {
            providerMsgId: msg.waMessageId,
            conversation: { organizationId },
          },
          select: { id: true },
        });
        if (duplicate) {
          app.log.info(
            { organizationId, waMessageId: msg.waMessageId },
            "Skipping duplicate inbound WhatsApp message",
          );
          continue;
        }
      }

      if (msg.isGroup && !whatsappGroupsEnabled) {
        app.log.info(
          { organizationId, groupJid: msg.groupJid },
          "Ignoring WhatsApp group message (feature whatsapp_groups disabled for organization)",
        );
        continue;
      }

      const phone = normalizePhoneE164(msg.from);
      if (!phone) {
        app.log.warn(`Invalid phone number from webhook: ${msg.from}`);
        continue;
      }

      msgMonitor = maybeStartMessageTrace({
        direction: "INBOUND",
        organizationId,
        inboxId: target.inboxId,
        provider: target.whatsappProvider,
        providerMessageId: msg.waMessageId,
        messageType: msg.type,
        bodyLength: msg.body?.length ?? 0,
      });

      let botDispatchStarted = false;
      const processInboundMessage = async (): Promise<void> => {
      let inboundBody = msg.body;
      if (msg.isGroup && (msg.participantPushName || msg.participantE164)) {
        const who = (msg.participantPushName || msg.participantE164 || "").trim();
        if (who) {
          inboundBody = inboundBody?.trim() ? `[${who}] ${inboundBody}` : `[${who}]`;
        }
      }

      let contact = await findContactByInboundPhone(prisma, organizationId, phone, msg.from);
      let contactJustCreated = false;

      if (msg.isGroup && contact && (contact.waId !== msg.groupJid || !contact.isGroupChat)) {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: {
            waId: msg.groupJid!,
            isGroupChat: true,
          },
        });
      }

      if (!contact) {
        const gid = (msg.groupJid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
        const defaultGroupName =
          gid.length >= 4 ? `Grupo · ${gid.slice(-8)}` : "Grupo WhatsApp";
        const displayName = msg.isGroup
          ? defaultGroupName
          : (msg.pushName?.trim() || phone);
        contact = await prisma.contact.create({
          data: {
            organizationId,
            phone,
            name: displayName,
            waId: msg.isGroup ? msg.groupJid! : msg.from,
            isGroupChat: Boolean(msg.isGroup),
          },
        });
        contactJustCreated = true;

        const unknownTag = await prisma.tag.findFirst({
          where: { organizationId, name: "Desconhecido" },
        });
        if (unknownTag && !msg.isGroup) {
          await prisma.contactTag.create({
            data: { contactId: contact.id, tagId: unknownTag.id },
          });
        }

        if (!msg.isGroup) {
          void syncContactProfilePicture({
            organizationId,
            contactId: contact.id,
            phone: contact.phone,
            profilePictureUrl: contact.profilePictureUrl,
            preferredInboxId: target.inboxId,
          }).catch(() => {});
        }
      }

      if (!contactJustCreated && !contact.profilePictureUrl && !msg.isGroup) {
        void syncContactProfilePicture({
          organizationId,
          contactId: contact.id,
          phone: contact.phone,
          profilePictureUrl: contact.profilePictureUrl,
          preferredInboxId: target.inboxId,
        }).catch(() => {});
      }

      msgMonitor?.stage("contact", "Contato localizado/criado");

      if (channelSettings.autoOptInOnFirstMessage && !contact.optedIn) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { optedIn: true, optedInAt: new Date() },
        });
      }

      const push = msg.pushName?.trim();
      if (push && !msg.isGroup) {
        const nameDigits = contact.name.replace(/\D/g, "");
        const phoneDigits = phone.replace(/\D/g, "");
        const nameLooksLikePhone = nameDigits.length >= 7 && nameDigits === phoneDigits;
        if (nameLooksLikePhone || contact.name === phone || contact.name === "Desconhecido") {
          contact = await prisma.contact.update({
            where: { id: contact.id },
            data: { name: push },
          });
        }
      }

      if (contact.isBlocked) {
        app.log.info(
          { organizationId, contactId: contact.id, phone },
          "Ignoring inbound WhatsApp message from blocked contact",
        );
        return;
      }

      msgMonitor?.stage("conversation", "Conversa localizada/criada");
      let conversation = await ensureConversationForChannelInbox({
        organizationId,
        contactId: contact.id,
        inboxId: target.inboxId,
        lockSingleConversation: channelSettings.lockSingleConversation,
        activeConversationStatus: useAgentBotOnInbox ? "PENDING" : "OPEN",
        createDefaults: {
          status: useAgentBotOnInbox ? "PENDING" : "OPEN",
          assignedToId: null,
        },
      });

      const deferMediaDownload = inboundMessageNeedsDeferredMediaDownload({
        deferEnabled: config.inboundMediaDeferDownloadEnabled,
        whatsappProvider: target.whatsappProvider,
        msgType: msg.type,
        metaMediaId: msg.metaMediaId,
        evolutionWebMessage: msg.evolutionWebMessage,
        existingMediaUrl: msg.mediaUrl,
        audioTranscriptionEnabled: channelSettings.audioTranscriptionEnabled,
        imageTranscriptionEnabled: channelSettings.imageTranscriptionEnabled,
      });

      let resolvedMediaUrl: string | null = msg.mediaUrl ?? null;
      let resolvedMediaType: string | null = msg.mediaType ?? null;
      if (
        !deferMediaDownload &&
        target.whatsappProvider === "evolution" &&
        msg.evolutionWebMessage &&
        (msg.type === "IMAGE" ||
          msg.type === "VIDEO" ||
          msg.type === "DOCUMENT" ||
          msg.type === "AUDIO")
      ) {
        const tryPersist = () =>
          persistEvolutionInboundMediaAsLocalUrl({
            organizationId,
            evolutionWebMessage: msg.evolutionWebMessage!,
          });
        let local = await tryPersist();
        if (!local) {
          await new Promise((r) => setTimeout(r, 1200));
          local = await tryPersist();
        }
        if (local) {
          resolvedMediaUrl = local.mediaUrl;
          resolvedMediaType = local.mediaType;
        } else {
          app.log.warn(
            { organizationId, waMessageId: msg.waMessageId, type: msg.type },
            "Evolution inbound media: getBase64FromMediaMessage failed — using original URL if any",
          );
        }
      }
      if (
        !deferMediaDownload &&
        target.whatsappProvider === "evolution_go" &&
        msg.evolutionWebMessage &&
        typeof msg.evolutionWebMessage.base64 === "string" &&
        msg.evolutionWebMessage.base64.trim()
      ) {
        const mimetype =
          typeof msg.evolutionWebMessage.mimetype === "string" && msg.evolutionWebMessage.mimetype.trim()
            ? msg.evolutionWebMessage.mimetype.trim()
            : resolvedMediaType ?? "application/octet-stream";
        const fileName =
          typeof msg.evolutionWebMessage.fileName === "string" && msg.evolutionWebMessage.fileName.trim()
            ? msg.evolutionWebMessage.fileName.trim()
            : undefined;
        const local = await persistEvolutionGoInboundMediaAsLocalUrl({
          base64: msg.evolutionWebMessage.base64.trim(),
          mimetype,
          fileName,
        });
        if (local) {
          resolvedMediaUrl = local.mediaUrl;
          resolvedMediaType = local.mediaType;
        }
      }
      if (
        !deferMediaDownload &&
        (target.whatsappProvider === "meta" || target.whatsappProvider === "360dialog") &&
        msg.metaMediaId &&
        (msg.type === "IMAGE" ||
          msg.type === "VIDEO" ||
          msg.type === "DOCUMENT" ||
          msg.type === "AUDIO")
      ) {
        const inboxRow = await prisma.inbox.findFirst({
          where: { id: target.inboxId, organizationId },
          select: {
            channelConfig: true,
            channelType: true,
            whatsappPhoneNumberId: true,
            isDefault: true,
          },
        });
        const inboxCreds = inboxRow
          ? await resolveInboxWhatsappCredentials(organizationId, inboxRow)
          : null;
        const accessToken = decrypt(inboxCreds?.whatsappApiKey) ?? "";
        if (accessToken) {
          const tryPersist = () =>
            persistMetaInboundMediaAsLocalUrl({
              accessToken,
              mediaId: msg.metaMediaId!,
              mimeTypeHint: msg.mediaType,
              fileName: msg.metaFileName,
            });
          let local = await tryPersist();
          if (!local) {
            await new Promise((r) => setTimeout(r, 800));
            local = await tryPersist();
          }
          if (local) {
            resolvedMediaUrl = local.mediaUrl;
            resolvedMediaType = local.mediaType;
          } else {
            app.log.warn(
              { organizationId, waMessageId: msg.waMessageId, type: msg.type },
              "Meta inbound media: Graph download failed",
            );
          }
        }
      }

      const inboundReply = await resolveInboundReplyTarget({
        organizationId,
        conversationId: conversation.id,
        quotedProviderMsgId: msg.quotedProviderMsgId,
      });

      msgMonitor?.stage("persist", "Mensagem persistida");
      let inbound;
      try {
        inbound = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: "INBOUND",
            type: msg.type as "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO",
            body: inboundBody,
            mediaUrl: resolvedMediaUrl,
            mediaType: resolvedMediaType,
            providerMsgId: msg.waMessageId,
            status: "DELIVERED",
            sentAt: msg.timestamp,
            replyToMessageId: inboundReply.replyToMessageId,
            replyToExternalMsgId: inboundReply.replyToExternalMsgId,
          },
          include: {
            replyTo: messageReplyToInclude,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          msg.waMessageId
        ) {
          app.log.info(
            { organizationId, waMessageId: msg.waMessageId },
            "Skipping duplicate inbound WhatsApp message (unique constraint)",
          );
          return;
        }
        throw err;
      }
      msgMonitor?.setIds({ conversationId: conversation.id, messageId: inbound.id });

      msgMonitor?.stage("realtime", "Realtime emitido");
      const bellNotify = resolveConversationBellNotify({
        conversationsAllScopeHumanOnly: channelSettings.conversationsAllScopeHumanOnly ?? false,
        agentBotTriageActive: useAgentBotOnInbox,
        status: conversation.status,
        assignedToId: conversation.assignedToId,
        awaitingHumanHandoff: conversation.awaitingHumanHandoff,
      });
      notifyConversationNewMessage(
        organizationId,
        conversation.id,
        serializeMessageForWorkspaceWs(inbound, {
          contactName: contact.name,
          replyTo: resolveMessageReplyForApi(inbound, contact.name),
        }),
        { bellNotify },
      );

      if (deferMediaDownload) {
        scheduleDeferredInboundMediaDownload({
          organizationId,
          inboxId: target.inboxId,
          messageId: inbound.id,
          conversationId: conversation.id,
          contactName: contact.name,
          whatsappProvider: target.whatsappProvider,
          msgType: msg.type,
          metaMediaId: msg.metaMediaId,
          metaFileName: msg.metaFileName,
          mediaTypeHint: msg.mediaType,
          evolutionWebMessage: msg.evolutionWebMessage as Record<string, unknown> | undefined,
          log: app.log,
        });
      }

      const conversationAgentCtx = await getAgentBotDispatchContextForInbox(
        organizationId,
        conversation.inboxId,
      );
      const waitForTranscription = await resolveWaitForInboundTranscription(
        organizationId,
        conversationAgentCtx,
      );

      const transcription = startInboundMediaTranscription({
        message: inbound,
        audioTranscriptionEnabled: channelSettings.audioTranscriptionEnabled,
        imageTranscriptionEnabled: channelSettings.imageTranscriptionEnabled,
        log: app.log,
      });

      msgMonitor?.stage("timeline", "Timeline CRM");
      msgMonitor?.stage("transcription", "Transcrição áudio/imagem");
      void appendTimelineEvent({
        organizationId,
        subjectType: "CONTACT",
        subjectId: contact.id,
        eventType: "message.inbound",
        channel: "whatsapp",
        payload: {
          messageId: inbound.id,
          conversationId: conversation.id,
          type: msg.type,
          body: inboundBody ?? inbound.body ?? null,
          mediaUrl: resolvedMediaUrl ?? null,
          providerMsgId: msg.waMessageId ?? null,
        },
        sourceId: msg.waMessageId ?? inbound.id,
        occurredAt: msg.timestamp ?? new Date(),
      }).catch((err) => {
        app.log.warn({ err }, "Failed to append contact timeline event");
      });
      void prisma.conversation
        .update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        })
        .catch((err) => {
          app.log.warn({ err, conversationId: conversation.id }, "Failed to bump conversation updatedAt");
        });

      const transcriptionResult = await awaitInboundTranscriptionGate({
        organizationId,
        conversationId: conversation.id,
        message: inbound,
        transcription,
        waitForTranscription,
        transcriptionTimeoutMs: config.inboundTranscriptionTimeoutMs,
        log: app.log,
      });
      const { message: inboundForPipeline } = transcriptionResult;
      const inboundBodyForRules = inboundForPipeline.body?.trim() ?? "";

      msgMonitor?.stage("auto_tags", "Auto-tags");
      if (inboundBodyForRules) {
        void (async () => {
          const rules = await getCachedAutoTagRules(organizationId);
          for (const rule of rules) {
            if (inboundBodyForRules.toLowerCase().includes(rule.keyword.toLowerCase())) {
              await prisma.contactTag.upsert({
                where: {
                  contactId_tagId: {
                    contactId: contact.id,
                    tagId: rule.tagId,
                  },
                },
                create: { contactId: contact.id, tagId: rule.tagId },
                update: {},
              });
            }
          }
        })().catch((err) => {
          app.log.warn({ err, contactId: contact.id }, "Inbound auto-tag apply failed");
        });
      }

      msgMonitor?.stage("bot_dispatch", "Dispatch bot/agente");
      if (conversationAgentCtx) {
        msgMonitor?.setBot({ triggered: true });
        const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id } });
        if (fresh) {
          botDispatchStarted = true;
          if (msgMonitor) deferMessageTraceFinish(msgMonitor);
          void dispatchAgentBotWebhook({
            organizationId,
            settings: {
              agentBotId: conversationAgentCtx.agentBotId,
              agentBot: conversationAgentCtx.agentBot,
            },
            conversation: fresh,
            contact,
            message: inboundForPipeline,
            log: app.log,
            messageTraceHandle: msgMonitor,
          })
            .catch((err) => {
              app.log.error(err, "Agent bot dispatch failed");
              completeDeferredMessageTrace(
                msgMonitor,
                "error",
                err instanceof Error ? err.message : String(err),
              );
            })
            .finally(() => {
              completeDeferredMessageTrace(msgMonitor, "completed");
            });
        }
      } else {
        app.log.warn(
          {
            organizationId,
            conversationId: conversation.id,
            inboxId: conversation.inboxId,
          },
          "Agent bot dispatch skipped: no active bot context found for inbox/settings",
        );
      }

      scheduleIntelligentTaggingDuringConversation(
        { organizationId, conversationId: conversation.id, triggerMessageId: inboundForPipeline.id },
        app.log,
      );
      };

      const processWithCache = () => runWithRequestLookupCache(processInboundMessage);
      if (msgMonitor) await runWithTraceHandle(msgMonitor, processWithCache);
      else await processWithCache();
      if (!botDispatchStarted) {
        finishMessageTrace(msgMonitor, "completed");
      }

      processedWebhookEvents += 1;
    } catch (err) {
      if (msgMonitor?.deferredFinish) {
        completeDeferredMessageTrace(
          msgMonitor,
          "error",
          err instanceof Error ? err.message : String(err),
        );
      } else {
        finishMessageTrace(msgMonitor, "error", err instanceof Error ? err.message : String(err));
      }
      app.log.error(err, "Error processing incoming webhook message");
    }
  }

  for (const reaction of reactionUpdates) {
    try {
      const phone = normalizePhoneE164(reaction.from);
      if (!phone) {
        app.log.warn({ from: reaction.from }, "Invalid phone on WhatsApp reaction webhook");
        continue;
      }

      const targetMsg = await prisma.message.findFirst({
        where: {
          providerMsgId: reaction.targetWaMessageId,
          conversation: { organizationId },
        },
        select: { id: true, conversationId: true },
      });
      if (!targetMsg) {
        app.log.info(
          { organizationId, targetWaMessageId: reaction.targetWaMessageId },
          "WhatsApp reaction target message not found",
        );
        continue;
      }

      await applyContactMessageReaction({
        messageId: targetMsg.id,
        phoneE164: phone,
        emoji: reaction.emoji,
      });

      const reactions = await loadMessageReactionsForApi(targetMsg.id);
      broadcastConversationMessageReactionsUpdated(
        organizationId,
        targetMsg.conversationId,
        targetMsg.id,
        reactions,
      );
      processedWebhookEvents += 1;
    } catch (err) {
      app.log.error(err, "Error processing WhatsApp reaction update");
    }
  }

  for (const status of statusUpdates) {
    try {
      const targetMsg = await prisma.message.findFirst({
        where: {
          providerMsgId: status.waMessageId,
          conversation: { organizationId },
        },
        select: { id: true, conversationId: true, status: true },
      });
      const statusPatch: { status: typeof status.status; providerError?: string | null } = {
        status: status.status,
      };
      if (status.status === "FAILED" && status.errorMessage) {
        statusPatch.providerError = sanitizeProviderErrorMessage(status.errorMessage);
      } else if (status.status === "DELIVERED" || status.status === "READ" || status.status === "SENT") {
        statusPatch.providerError = null;
      }
      await prisma.message.updateMany({
        where: {
          providerMsgId: status.waMessageId,
          conversation: { organizationId },
        },
        data: statusPatch,
      });
      /** Cost Policy: cobrança da Meta baseia-se em ENTREGA — atualizar o ledger com o status real. */
      void updateLedgerDeliveryStatus({
        organizationId,
        providerMessageId: status.waMessageId,
        status: status.status,
        metaPricing: status.metaPricing ?? null,
      });
      if (targetMsg) {
        broadcastConversationMessageUpdated(organizationId, targetMsg.conversationId, {
          id: targetMsg.id,
          status: status.status,
          providerError: statusPatch.providerError ?? null,
        });
      }
      processedWebhookEvents += 1;
    } catch (err) {
      app.log.error(err, "Error processing status update");
    }
  }

  if (
    processedWebhookEvents > 0 ||
    statusUpdates.length > 0 ||
    reactionUpdates.length > 0 ||
    messages.length > 0 ||
    isMetaCloudWebhookPayload(body)
  ) {
    void recordWhatsappInboundWebhook(target.inboxId).catch((err) =>
      app.log.warn({ err, inboxId: target.inboxId }, "Failed to record WhatsApp webhook activity"),
    );
  }

  return processedWebhookEvents;
}
