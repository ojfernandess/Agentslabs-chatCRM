import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import type { NvoipTorpedoDtmfRule } from "./broadcastTypes.js";
import { appendTimelineEvent } from "./timeline.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";

function extractDigit(body: Record<string, unknown>): string | null {
  for (const key of ["digit", "dtmf", "key", "pressed", "option"]) {
    const v = body[key];
    if (v != null && String(v).trim()) return String(v).replace(/\D/g, "").slice(0, 1);
  }
  return null;
}

export async function handleNvoipDtmfWebhook(input: {
  organizationId: string;
  dispatchId: string;
  token: string;
  body: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const enabled = await isOrganizationFeatureEnabled(input.organizationId, "nvoip_voice");
  if (!enabled) {
    return { ok: false, status: 403, message: "nvoip_voice_disabled" };
  }

  const dispatch = await prisma.nvoipTorpedoDispatch.findFirst({
    where: {
      id: input.dispatchId,
      organizationId: input.organizationId,
      webhookToken: input.token,
    },
    include: { contact: true },
  });
  if (!dispatch) {
    return { ok: false, status: 404, message: "dispatch_not_found" };
  }

  const digit = extractDigit(input.body);
  if (!digit) {
    return { ok: false, status: 400, message: "digit_required" };
  }

  const rules = Array.isArray(dispatch.dtmfRules)
    ? (dispatch.dtmfRules as unknown as NvoipTorpedoDtmfRule[])
    : [];
  const rule = rules.find((r) => r.digit.replace(/\D/g, "").slice(0, 1) === digit);

  const pressed = {
    ...((dispatch.dtmfPressed as Record<string, unknown>) ?? {}),
    [digit]: { at: new Date().toISOString(), raw: input.body },
  };

  await prisma.nvoipTorpedoDispatch.update({
    where: { id: dispatch.id },
    data: {
      dtmfPressed: pressed as object,
      rawPayload: {
        ...((dispatch.rawPayload as Record<string, unknown>) ?? {}),
        lastDtmf: input.body,
      } as object,
    },
  });

  if (!dispatch.contactId || !dispatch.contact) {
    return { ok: true };
  }

  if (rule?.tagId) {
    await prisma.contactTag.upsert({
      where: {
        contactId_tagId: { contactId: dispatch.contactId, tagId: rule.tagId },
      },
      create: { contactId: dispatch.contactId, tagId: rule.tagId },
      update: {},
    });
  }

  if (rule?.pipelineStageId) {
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: rule.pipelineStageId, pipeline: { organizationId: input.organizationId } },
    });
    if (stage) {
      await prisma.contact.update({
        where: { id: dispatch.contactId },
        data: { pipelineStageId: stage.id },
      });
    }
  }

  await appendTimelineEvent({
    organizationId: input.organizationId,
    subjectType: "CONTACT",
    subjectId: dispatch.contactId,
    eventType: "nvoip_dtmf",
    channel: "NVOIP",
    sourceId: dispatch.id,
    payload: {
      digit,
      label: rule?.label ?? null,
      tagId: rule?.tagId ?? null,
      pipelineStageId: rule?.pipelineStageId ?? null,
    },
  });

  await writeNvoipIntegrationLog({
    organizationId: input.organizationId,
    nvoipAccountId: dispatch.nvoipAccountId,
    level: "info",
    eventType: "dtmf_received",
    message: `DTMF ${digit} on torpedo ${dispatch.id.slice(0, 8)}`,
    payload: input.body,
  });

  return { ok: true };
}
