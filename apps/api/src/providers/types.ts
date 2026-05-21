export interface SendMessageParams {
  to: string;
  type: string;
  body?: string;
  mediaUrl?: string;
  /** MIME explícito (upload) — Evolution usa para mimetype no sendMedia. */
  mediaType?: string;
  /** Nome do modelo na Meta (message template name). */
  templateName?: string;
  /** Código de idioma do modelo (ex. pt_BR). */
  templateLanguage?: string;
  /** Valores {{1}}, {{2}}, … para o componente BODY (Cloud API). */
  templateBodyParameters?: string[];
  /** Botões de resposta rápida (Meta interactive, máx. 3). */
  interactiveButtons?: { id: string; title: string }[];
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
  /** Evolution messages.upsert: registo completo para POST getBase64FromMediaMessage. */
  evolutionWebMessage?: Record<string, unknown>;
  /** Meta Cloud API: ID do media object para download via Graph API. */
  metaMediaId?: string;
  /** Nome de ficheiro em documentos Meta. */
  metaFileName?: string;
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
  /** Opcional — Evolution API: URL da foto de perfil WhatsApp. */
  fetchContactProfilePictureUrl?(phone: string): Promise<string | undefined>;
  /** Opcional — Evolution Go: imagem em base64 via /user/avatar. */
  fetchContactProfilePictureBuffer?(phone: string): Promise<Buffer | null>;
}
