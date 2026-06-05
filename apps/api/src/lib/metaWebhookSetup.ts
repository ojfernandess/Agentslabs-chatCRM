import { decrypt } from "./encryption.js";
import {
  isMetaCloudWhatsappProvider,
  parseInboxWhatsappFromChannelConfig,
  resolveInboxWhatsappCredentials,
} from "./inboxWhatsappConfig.js";
import { fetchWabaIdFromPhoneNumberId } from "./metaWabaTemplates.js";
import { getWhatsAppEmbeddedConfig, subscribeWabaToApp } from "./metaWhatsAppEmbedded.js";

export type MetaWebhookSetupResult = {
  wabaSubscribed: boolean;
  wabaId: string | null;
  note: string | null;
};

/** Garante que a WABA está subscrita ao app (campo messages) após conectar Meta Cloud. */
export async function ensureMetaCloudWabaSubscribed(input: {
  organizationId: string;
  inbox: { channelConfig: unknown };
}): Promise<MetaWebhookSetupResult> {
  const creds = await resolveInboxWhatsappCredentials(input.organizationId, input.inbox);
  if (!creds || !isMetaCloudWhatsappProvider(creds.whatsappProvider)) {
    return { wabaSubscribed: false, wabaId: null, note: null };
  }

  const accessToken = creds.whatsappApiKey ? decrypt(creds.whatsappApiKey) : null;
  const phoneNumberId = creds.whatsappPhoneNumberId?.trim();
  if (!accessToken || !phoneNumberId) {
    return { wabaSubscribed: false, wabaId: null, note: "credentials_incomplete" };
  }

  const parsed = parseInboxWhatsappFromChannelConfig(input.inbox.channelConfig);
  let wabaId = parsed.whatsappBusinessAccountId?.trim() ?? null;
  if (!wabaId) {
    wabaId = await fetchWabaIdFromPhoneNumberId(phoneNumberId, accessToken);
  }
  if (!wabaId) {
    return { wabaSubscribed: false, wabaId: null, note: "waba_id_unknown" };
  }

  const embedded = await getWhatsAppEmbeddedConfig();
  if (!embedded) {
    return { wabaSubscribed: false, wabaId, note: "embedded_not_configured" };
  }

  try {
    await subscribeWabaToApp(wabaId, accessToken, embedded);
    return { wabaSubscribed: true, wabaId, note: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "subscribe_failed";
    return { wabaSubscribed: false, wabaId, note: msg };
  }
}
