import { z } from "zod";

/** Payload JSON para POST /messages — validação partilhada (API + testes). */
export const sendMessageSchema = z
  .object({
    contactId: z.string().uuid(),
    type: z.enum(["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "TEMPLATE"]),
    body: z.string().max(4096).optional(),
    templateId: z.string().uuid().optional(),
    mediaUrl: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "TEMPLATE") {
      if (!data.templateId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["templateId"],
          message: "templateId is required for TEMPLATE messages",
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
