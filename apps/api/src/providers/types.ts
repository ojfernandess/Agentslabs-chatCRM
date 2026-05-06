export interface SendMessageParams {
  to: string;
  type: string;
  body?: string;
  mediaUrl?: string;
  /** MIME explícito (upload) — Evolution usa para mimetype no sendMedia. */
  mediaType?: string;
  templateName?: string;
}

export interface IncomingMessage {
  from: string;
  waMessageId: string;
  type: string;
  body?: string;
  mediaUrl?: string;
  mediaType?: string;
  timestamp: Date;
  /** Nome push do WhatsApp (Baileys / Evolution), p.ex. em messages.upsert. */
  pushName?: string;
  /** Mensagem de grupo — `from` é telefone E.164 sintético; usar `groupJid` para enviar respostas. */
  isGroup?: boolean;
  groupJid?: string;
  participantE164?: string | null;
  participantPushName?: string | null;
}

export interface StatusUpdate {
  waMessageId: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  timestamp: Date;
  errorMessage?: string;
}

/** Evolution (Baileys) CONTACTS_* webhooks — outros provedores podem devolver vazio. */
export interface ContactSyncPatch {
  phone: string;
  profilePictureUrl?: string | null;
  waDisplayName?: string | null;
}

export type WebhookParseResult = {
  messages: IncomingMessage[];
  statusUpdates: StatusUpdate[];
  contactSync?: ContactSyncPatch[];
};

export interface WhatsAppProviderInterface {
  /** Send a message and return the provider message ID */
  sendMessage(params: SendMessageParams): Promise<string>;

  /** Parse an incoming webhook payload into messages and status updates */
  parseWebhook(
    headers: Record<string, string | undefined>,
    body: unknown,
  ): WebhookParseResult;

  /** Validate webhook signature (HMAC) */
  validateWebhookSignature(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret: string,
  ): boolean;

  /** Handle webhook verification challenge */
  handleVerification(query: Record<string, string>): string | null;

  /** Check provider connectivity */
  healthCheck(): Promise<boolean>;
  /** Opcional — só Evolution API: URL da foto de perfil WhatsApp. */
  fetchContactProfilePictureUrl?(phone: string): Promise<string | undefined>;
}
