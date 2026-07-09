import { z } from "zod";

/** Payload JSON para POST /messages — validação partilhada (API + testes). */
export const sendMessageSchema = z
  .object({
    contactId: z.string().uuid(),
    /** Quando envia a partir de uma conversa aberta, fixa a caixa (WhatsApp vs API / widget / …). */
    conversationId: z.string().uuid().optional(),
    /** Sem conversationId: abre ou reutiliza conversa nesta caixa (painel / mensagem rápida). Ignorado se conversationId estiver definido. */
    inboxId: z.string().uuid().optional(),
    type: z.enum(["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "TEMPLATE"]),
    body: z.string().max(4096).optional(),
    templateId: z.string().uuid().optional(),
    mediaUrl: z.string().url().optional(),
    /** MIME do ficheiro (ex.: image/png) — melhora envio Evolution/Meta. */
    mediaType: z.string().max(128).optional(),
    /** Nota interna: não contacta o cliente no WhatsApp. */
    isPrivate: z.boolean().optional(),
    /** Valores para {{1}}, {{2}}, … no modelo WhatsApp Cloud API. */
    templateBodyParameters: z.array(z.string().max(4096)).max(20).optional(),
    /** Assunto do e-mail (canal EMAIL). Se omitido, o servidor gera um padrão. */
    emailSubject: z.string().max(998).optional(),
    /** Destinatários To (vírgula/ponto-e-vírgula). Se omitido, usa o e-mail do contato. */
    emailTo: z.string().max(4000).optional(),
    /** Cópia (Cc). */
    emailCc: z.string().max(4000).optional(),
    /** Cópia oculta (Cco / Bcc). */
    emailBcc: z.string().max(4000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "TEMPLATE") {
      if (data.isPrivate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["isPrivate"],
          message: "private notes cannot use templates",
        });
      }
      if (!data.templateId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["templateId"],
          message: "templateId is required for TEMPLATE messages",
        });
      }
      return;
    }

    if (data.isPrivate) {
      if (["IMAGE", "DOCUMENT", "AUDIO", "VIDEO"].includes(data.type)) {
        if (!data.mediaUrl?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mediaUrl"],
            message: `mediaUrl is required for private ${data.type} notes`,
          });
        }
        return;
      }
      if (data.type === "TEXT") {
        const t = data.body?.trim() ?? "";
        if (!t) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["body"],
            message: "body is required for private text notes",
          });
        }
      }
      return;
    }

    if (data.type === "TEXT") {
      const t = data.body?.trim() ?? "";
      if (!t) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["body"],
          message: "body is required for TEXT messages",
        });
      }
      return;
    }

    if (["IMAGE", "DOCUMENT", "AUDIO", "VIDEO"].includes(data.type)) {
      if (!data.mediaUrl?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaUrl"],
          message: `mediaUrl is required for ${data.type} messages (public HTTPS URL readable by WhatsApp)`,
        });
      }
    }
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
