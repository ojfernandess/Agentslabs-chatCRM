export type WhatsappInboxChannelPatch = {
  whatsappProvider?: string;
  whatsappPhoneNumberId?: string;
  whatsappApiKey?: string;
  whatsappWebhookSecret?: string;
  whatsappDisplayPhone?: string;
  whatsappBusinessAccountId?: string;
  evolutionApiBaseUrl?: string;
};

/** @deprecated Use `syncWhatsappCredentialsToInbox` from `whatsappOrgSync.js`. */
export { syncWhatsappCredentialsToInbox as syncWhatsappCredentialsToDefaultInbox } from "./whatsappOrgSync.js";
