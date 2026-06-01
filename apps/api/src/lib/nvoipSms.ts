import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { normalizeDialPhone } from "./nvoipCallContext.js";
import { nvoipSendSms } from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";
import { nvoipVoiceSafeText } from "./nvoipTorpedo.js";
import { appendTimelineEvent } from "./timeline.js";

export async function requireConnectedNvoipAccount(organizationId: string) {
  const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
  if (!account) throw new Error("nvoip_not_configured");
  if (account.status !== "CONNECTED") throw new Error("nvoip_account_not_connected");
  return account;
}

export async function sendNvoipSmsToPhone(input: {
  organizationId: string;
  phone: string;
  message: string;
  flashSms?: boolean;
  actorUserId?: string;
  contactId?: string;
}): Promise<void> {
  const smsEnabled = await isOrganizationFeatureEnabled(input.organizationId, "nvoip_sms");
  if (!smsEnabled) throw new Error("nvoip_sms_disabled");

  const account = await requireConnectedNvoipAccount(input.organizationId);
  const dialPhone = normalizeDialPhone(input.phone);
  if (!dialPhone) throw new Error("invalid_phone");

  const body = nvoipVoiceSafeText(input.message, 160);
  if (!body) throw new Error("empty_message");

  await nvoipSendSms(account, {
    phone: dialPhone,
    message: body,
    flashSms: input.flashSms,
  });

  if (input.contactId) {
    await appendTimelineEvent({
      organizationId: input.organizationId,
      subjectType: "CONTACT",
      subjectId: input.contactId,
      eventType: "nvoip_sms",
      channel: "NVOIP_SMS",
      actorUserId: input.actorUserId ?? null,
      payload: {
        title: "SMS Nvoip",
        phone: dialPhone,
        messagePreview: body.slice(0, 80),
        flashSms: Boolean(input.flashSms),
      },
    });
  }

  await writeNvoipIntegrationLog({
    organizationId: input.organizationId,
    nvoipAccountId: account.id,
    level: "info",
    eventType: "sms_sent",
    message: `SMS to ${dialPhone} (${body.length} chars)`,
  });
}
