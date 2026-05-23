import { Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { buildCsatWhatsAppBody, newCsatSurveyToken } from "./csatSurvey.js";
import { ensurePipelineStageForLeadType } from "./pipelineLeadTypeSync.js";
import { syncDealsForContactPipelineStage } from "./dealStageSync.js";
import { createConversationClosureRecord } from "./conversationClosureRecords.js";

const AUTO_CLOSURE_REASON = "Resolução automática por inatividade.";
const inFlight = new Set<string>();

async function findActorUserId(organizationId: string): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { organizationId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (admin) return admin.id;
  const anyUser = await prisma.user.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return anyUser?.id ?? null;
}

async function listIdleConversationIds(
  organizationId: string,
  cutoff: Date,
  skipWhenAssigned: boolean,
): Promise<string[]> {
  const assignedClause = skipWhenAssigned ? Prisma.sql`AND c.assigned_to_id IS NULL` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id
    FROM conversations c
    WHERE c.organization_id = ${organizationId}::uuid
      AND c.status IN ('OPEN', 'PENDING')
      ${assignedClause}
      AND COALESCE(
        (SELECT MAX(m.created_at) FROM messages m
         WHERE m.conversation_id = c.id AND m.is_private = false),
        c.created_at
      ) < ${cutoff}
    ORDER BY c.updated_at ASC
    LIMIT 12
  `;
  return rows.map((r) => r.id);
}

async function processOneConversation(
  conversationId: string,
  organizationId: string,
  wf: {
    autoResolveLeadTypeId: string;
    autoResolveTagId: string | null;
    autoResolveCustomerMessage: string | null;
    autoResolveSkipWhenAssigned: boolean;
    autoResolveInactivityMinutes: number;
    csatEnabled: boolean;
    csatSurveyMessage: string | null;
  },
  log: FastifyBaseLogger,
): Promise<void> {
  if (inFlight.has(conversationId)) return;
  inFlight.add(conversationId);
  try {
    const actorUserId = await findActorUserId(organizationId);
    if (!actorUserId) {
      log.warn({ organizationId }, "auto-resolve: no user in organization to attribute resolution");
      return;
    }

    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: {
        id: true,
        status: true,
        contactId: true,
        assignedToId: true,
        inboxId: true,
      },
    });
    if (!existing || (existing.status !== "OPEN" && existing.status !== "PENDING")) return;

    const cutoff = new Date(Date.now() - wf.autoResolveInactivityMinutes * 60 * 1000);
    const stillIdle = await listIdleConversationIds(organizationId, cutoff, wf.autoResolveSkipWhenAssigned);
    if (!stillIdle.includes(conversationId)) return;

    const ltid = wf.autoResolveLeadTypeId;
    const leadType = await prisma.leadType.findFirst({
      where: { id: ltid, organizationId },
      select: { id: true },
    });
    if (!leadType) return;

    const csatToken = wf.csatEnabled ? newCsatSurveyToken() : null;

    const { conversation } = await prisma.$transaction(async (tx) => {
      const stage = await ensurePipelineStageForLeadType(tx, organizationId, ltid);
      await tx.contact.update({
        where: { id: existing.contactId },
        data: { pipelineStageId: stage.id },
      });
      await syncDealsForContactPipelineStage(tx, organizationId, existing.contactId, stage.id);

      const assignPatch =
        existing.assignedToId == null ? { assignedToId: actorUserId } : {};

      const conv = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: "RESOLVED",
          leadTypeId: ltid,
          closureReason: AUTO_CLOSURE_REASON,
          closureValue: null,
          csatSurveyToken: csatToken,
          csatScore: null,
          csatComment: null,
          csatRecordedAt: null,
          ...assignPatch,
        },
        select: {
          id: true,
          contactId: true,
          csatSurveyToken: true,
          assignedToId: true,
          teamId: true,
        },
      });
      await createConversationClosureRecord(tx, {
        organizationId,
        conversationId,
        resolvedById: actorUserId,
        assignedToId: conv.assignedToId,
        teamId: conv.teamId,
        leadTypeId: ltid,
        closureReason: AUTO_CLOSURE_REASON,
        closureValue: null,
      });
      return { conversation: conv };
    });

    if (wf.csatEnabled && conversation.csatSurveyToken) {
      const intro = wf.csatSurveyMessage?.trim() ?? "";
      const bodyText = buildCsatWhatsAppBody(intro, conversation.csatSurveyToken);
      try {
        await deliverOutboundWhatsAppMessage({
          organizationId,
          data: {
            contactId: existing.contactId,
            type: "TEXT",
            body: bodyText,
          },
          actor: { kind: "user", userId: actorUserId },
          log,
          newConversation: { status: "OPEN", assignedToId: actorUserId },
          pinnedConversationId: conversation.id,
        });
      } catch (err) {
        log.warn({ err, conversationId }, "auto-resolve: CSAT WhatsApp send failed");
      }
    }

    const custom = wf.autoResolveCustomerMessage?.trim();
    if (custom) {
      try {
        await deliverOutboundWhatsAppMessage({
          organizationId,
          data: {
            contactId: existing.contactId,
            type: "TEXT",
            body: custom,
          },
          actor: { kind: "user", userId: actorUserId },
          log,
          newConversation: { status: "OPEN", assignedToId: actorUserId },
          pinnedConversationId: conversation.id,
        });
      } catch (err) {
        log.warn({ err, conversationId }, "auto-resolve: custom message WhatsApp send failed");
      }
    }

    if (wf.autoResolveTagId) {
      await prisma.contactTag.createMany({
        data: [{ contactId: existing.contactId, tagId: wf.autoResolveTagId }],
        skipDuplicates: true,
      });
    }
  } finally {
    inFlight.delete(conversationId);
  }
}

/** Chamado periodicamente pelo servidor para aplicar resolução automática por inatividade. */
export async function runAutoResolveInactiveConversationsTick(opts: { log: FastifyBaseLogger }): Promise<void> {
  const { log } = opts;
  try {
    const configs = await prisma.settings.findMany({
      where: {
        autoResolveConversationsEnabled: true,
        autoResolveLeadTypeId: { not: null },
      },
      select: {
        organizationId: true,
        autoResolveInactivityMinutes: true,
        autoResolveCustomerMessage: true,
        autoResolveSkipWhenAssigned: true,
        autoResolveTagId: true,
        autoResolveLeadTypeId: true,
        csatEnabled: true,
        csatSurveyMessage: true,
      },
    });

    for (const wf of configs) {
      const ltid = wf.autoResolveLeadTypeId;
      if (!ltid) continue;
      const minutes = Math.min(43_200, Math.max(1, wf.autoResolveInactivityMinutes));
      const cutoff = new Date(Date.now() - minutes * 60 * 1000);
      const ids = await listIdleConversationIds(
        wf.organizationId,
        cutoff,
        wf.autoResolveSkipWhenAssigned,
      );
      for (const id of ids) {
        await processOneConversation(
          id,
          wf.organizationId,
          {
            autoResolveLeadTypeId: ltid,
            autoResolveTagId: wf.autoResolveTagId,
            autoResolveCustomerMessage: wf.autoResolveCustomerMessage,
            autoResolveSkipWhenAssigned: wf.autoResolveSkipWhenAssigned,
            autoResolveInactivityMinutes: minutes,
            csatEnabled: wf.csatEnabled,
            csatSurveyMessage: wf.csatSurveyMessage,
          },
          log,
        );
      }
    }
  } catch (err) {
    log.warn({ err }, "auto-resolve tick failed");
  }
}
