import type { InboxChannelType } from "@prisma/client";

/**
 * Estrutura de `channelConfig` inspirada no modelo de canais do Chatwoot (credenciais por inbox,
 * website URL, tokens de plataforma). Os campos são opcionais consoante o canal.
 *
 * Ref.: https://www.chatwoot.com/docs/product/channels/live-chat
 * https://developers.chatwoot.com/api-reference/introduction
 */
export type ChannelNativeConfig = {
  websiteUrl?: string;
  /** Cor do widget (hex), quando existir UI de widget. */
  widgetColor?: string;
  /** Telegram Bot API */
  telegramBotToken?: string;
  /** Facebook Messenger (Graph) */
  facebookPageId?: string;
  facebookPageAccessToken?: string;
  facebookVerifyToken?: string;
  appSecret?: string;
  /** Instagram Messaging (Graph) */
  instagramPageId?: string;
  instagramAccessToken?: string;
  /** Verificação do webhook Meta (hub.verify_token), mesmo fluxo que Messenger. */
  instagramVerifyToken?: string;
  /** LINE Messaging API */
  lineChannelId?: string;
  lineChannelSecret?: string;
  lineChannelAccessToken?: string;
  /** Twilio SMS / Voice */
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  /** E-mail (canal tipo IMAP/SMTP ou reencaminhamento — evolução futura) */
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpUser?: string;
  emailSmtpPassword?: string;
  emailFromAddress?: string;
  emailImapHost?: string;
  emailImapPort?: number;
  /** Legado / personalização */
  outboundWebhookUrl?: string;
};

export function telegramChatIdFromContactPhone(phone: string, channelType: InboxChannelType): string | null {
  if (channelType !== "TELEGRAM") return null;
  const prefix = "oc|TELEGRAM|";
  if (!phone.startsWith(prefix)) return null;
  const id = phone.slice(prefix.length).trim();
  return id.length > 0 ? id : null;
}
