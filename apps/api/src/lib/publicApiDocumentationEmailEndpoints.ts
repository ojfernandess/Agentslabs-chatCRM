import type { PublicApiDocEndpoint } from "./publicApiDocumentationCatalog.js";

/** Rotas do workspace de e-mail (caixas EMAIL, pastas, favoritos, compose). */
export const PUBLIC_EMAIL_API_DOCUMENTATION_ENDPOINTS: PublicApiDocEndpoint[] = [
  {
    method: "GET",
    path: "/api/v1/inboxes/email-unread-counts",
    auth: "session_jwt",
    descriptionEn:
      "Per-inbox unread counts for the sidebar (only INBOUND last message, excludes trash).",
    descriptionPt:
      "Contadores de não lidos por caixa de e-mail no menu (só última mensagem INBOUND; exclui lixeira).",
    examplePayloadPt:
      "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>\n\nResposta 200:\n{\n  \"<uuid-caixa-email>\": 3\n}",
  },
  {
    method: "GET",
    path: "/api/v1/inboxes/:id/email-folders",
    auth: "session_jwt",
    descriptionEn: "List custom email folders for the current user and inbox.",
    descriptionPt: "Listar pastas personalizadas de e-mail do utilizador atual nesta caixa.",
    examplePayloadPt:
      "Sem corpo. GET /api/v1/inboxes/<uuid-caixa-email>/email-folders\n\nResposta 200:\n{\n  \"data\": [\n    { \"id\": \"<uuid>\", \"name\": \"Clientes VIP\", \"sortOrder\": 0, \"createdAt\": \"...\" }\n  ]\n}",
  },
  {
    method: "POST",
    path: "/api/v1/inboxes/:id/email-folders",
    auth: "session_jwt",
    descriptionEn: "Create a custom email folder (per user, per inbox).",
    descriptionPt: "Criar pasta personalizada de e-mail (por utilizador e caixa).",
    examplePayloadPt:
      'POST application/json:\n{\n  "name": "Propostas 2026"\n}\n\n409 se já existir pasta com o mesmo nome nesta caixa.',
  },
  {
    method: "PATCH",
    path: "/api/v1/inboxes/:id/email-folders/:folderId",
    auth: "session_jwt",
    descriptionEn: "Rename a custom email folder.",
    descriptionPt: "Renomear pasta personalizada de e-mail.",
    examplePayloadPt:
      'PATCH application/json:\n{\n  "name": "Propostas enviadas"\n}',
  },
  {
    method: "DELETE",
    path: "/api/v1/inboxes/:id/email-folders/:folderId",
    auth: "session_jwt",
    descriptionEn: "Delete folder; conversations in it return to inbox (folder assignment cleared).",
    descriptionPt: "Eliminar pasta; conversas voltam à caixa de entrada (atribuição de pasta removida).",
    examplePayloadPt: "Sem corpo. DELETE /api/v1/inboxes/<inboxId>/email-folders/<folderId> → 204",
  },
  {
    method: "POST",
    path: "/api/v1/inboxes/:id/compose-email",
    auth: "session_jwt",
    descriptionEn:
      "Send a new outbound email from an EMAIL inbox (SMTP must be configured). Creates/links contact and conversation.",
    descriptionPt:
      "Enviar novo e-mail de saída numa caixa EMAIL (SMTP configurado). Cria ou associa contacto e conversa.",
    examplePayloadPt:
      'POST application/json:\n{\n  "toEmails": ["cliente@exemplo.com"],\n  "toName": "Maria Silva (opcional)",\n  "cc": ["gestor@exemplo.com"],\n  "bcc": [],\n  "subject": "Proposta comercial",\n  "body": "Olá Maria, segue nossa proposta."\n}\n\nAlternativa: "toEmail": "a@ex.com, b@ex.com" (lista separada por vírgula).\n\nResposta: { "conversationId": "<uuid>", "contactId": "<uuid>" }',
  },
  {
    method: "POST",
    path: "/api/v1/inboxes/:id/sync-email",
    auth: "session_jwt",
    descriptionEn: "Trigger IMAP sync for an EMAIL inbox (imports new messages).",
    descriptionPt: "Disparar sincronização IMAP da caixa de e-mail (importa mensagens novas).",
    examplePayloadPt:
      "Sem corpo ou query ?reprocess=1 para reprocessar.\n\nPOST /api/v1/inboxes/<uuid>/sync-email\n\nResposta: { \"processed\": 2, \"skipped\": 0 }",
  },
  {
    method: "POST",
    path: "/api/v1/inboxes/:id/test-email-connection",
    auth: "session_jwt",
    descriptionEn: "Test SMTP (and optional saved config) for an EMAIL inbox.",
    descriptionPt: "Testar ligação SMTP da caixa de e-mail.",
    examplePayloadPt:
      'POST application/json (opcional — usa config guardada se omitido):\n{\n  "channelConfig": {\n    "emailFromAddress": "suporte@empresa.com",\n    "emailSmtpHost": "smtp.empresa.com",\n    "emailSmtpPort": 587,\n    "emailSmtpUser": "suporte@empresa.com",\n    "emailSmtpPassword": "<senha>"\n  }\n}\n\nResposta: { "connected": true, "error": null, "sentTo": "..." }',
  },
  {
    method: "POST",
    path: "/api/v1/conversations/:id/star",
    auth: "session_jwt",
    descriptionEn: "Star or unstar an email conversation (per user; EMAIL channel only).",
    descriptionPt: "Favoritar ou remover favorito de conversa de e-mail (por utilizador; só canal EMAIL).",
    examplePayloadPt:
      'POST application/json:\n{\n  "starred": true\n}\n\nResposta: { "starred": true }',
  },
  {
    method: "POST",
    path: "/api/v1/conversations/:id/email-folder",
    auth: "session_jwt",
    descriptionEn: "Move email conversation to a custom folder or back to inbox (folderId null).",
    descriptionPt: "Mover conversa de e-mail para pasta personalizada ou voltar à caixa (folderId null).",
    examplePayloadPt:
      'POST application/json:\n{\n  "folderId": "<uuid-pasta-ou-null>"\n}\n\nnull = caixa de entrada (sem pasta customizada).',
  },
  {
    method: "POST",
    path: "/api/v1/conversations/:id/read",
    auth: "session_jwt",
    descriptionEn: "Mark conversation as read for the current user.",
    descriptionPt: "Marcar conversa como lida para o utilizador atual.",
    examplePayloadPt: "Sem corpo. POST /api/v1/conversations/<uuid>/read → 204",
  },
  {
    method: "POST",
    path: "/api/v1/conversations/:id/unread",
    auth: "session_jwt",
    descriptionEn: "Mark conversation as unread for the current user.",
    descriptionPt: "Marcar conversa como não lida para o utilizador atual.",
    examplePayloadPt: "Sem corpo. POST /api/v1/conversations/<uuid>/unread → 204",
  },
  {
    method: "DELETE",
    path: "/api/v1/conversations/:id",
    auth: "session_jwt",
    descriptionEn: "Soft-delete conversation (email trash / deletedAt).",
    descriptionPt: "Eliminar conversa para a lixeira (soft-delete / deletedAt).",
    examplePayloadPt: "Sem corpo. DELETE /api/v1/conversations/<uuid> → conversa vai para lixeira de e-mail.",
  },
  {
    method: "POST",
    path: "/api/v1/conversations/:id/restore",
    auth: "session_jwt",
    descriptionEn: "Restore conversation from trash.",
    descriptionPt: "Restaurar conversa da lixeira.",
    examplePayloadPt: "Sem corpo. POST /api/v1/conversations/<uuid>/restore",
  },
];
