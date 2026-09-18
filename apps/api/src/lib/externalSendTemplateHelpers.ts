import { z } from "zod";

const metaComponentParameterSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    parameter_name: z.string().optional(),
  })
  .passthrough();

const metaComponentSchema = z
  .object({
    type: z.string(),
    parameters: z.array(metaComponentParameterSchema).optional(),
    sub_type: z.string().optional(),
    index: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const uuidFieldSchema = z.string().uuid();

const sendTemplateDataSchema = z.object({
  organizationId: uuidFieldSchema.optional(),
  inboxId: uuidFieldSchema.optional(),
  templateId: z.string().min(1),
  sendToWA: z.boolean().optional().default(true),
  inboxType: z.enum(["ai", "human"]).optional().default("human"),
  components: z.array(metaComponentSchema).optional(),
});

export const externalSendTemplateBodySchema = z
  .object({
    organizationId: uuidFieldSchema.optional(),
    inboxId: uuidFieldSchema.optional(),
    from: z.string().max(64).optional(),
    to: z.string().max(32).optional(),
    recipient: z.string().max(128).optional(),
    templateId: z.string().min(1).optional(),
    sendToWA: z.boolean().optional(),
    inboxType: z.enum(["ai", "human"]).optional(),
    components: z.array(metaComponentSchema).optional(),
    data: sendTemplateDataSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const to = val.to?.trim();
    const recipient = val.recipient?.trim();
    if (!to && !recipient) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "to or recipient is required", path: ["to"] });
    }
    const templateId = val.data?.templateId ?? val.templateId;
    if (!templateId?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "templateId is required", path: ["templateId"] });
    }
  });

export type ExternalSendTemplateBody = z.infer<typeof externalSendTemplateBodySchema>;

export function normalizeExternalSendTemplatePayload(body: ExternalSendTemplateBody): {
  organizationId?: string;
  inboxId?: string;
  from?: string;
  to?: string;
  recipient?: string;
  templateId: string;
  sendToWA: boolean;
  inboxType: "ai" | "human";
  components?: z.infer<typeof metaComponentSchema>[];
} {
  const nested = body.data;
  return {
    organizationId: nested?.organizationId ?? body.organizationId,
    inboxId: nested?.inboxId ?? body.inboxId,
    from: body.from?.trim() || undefined,
    to: body.to?.trim() || undefined,
    recipient: body.recipient?.trim() || undefined,
    templateId: (nested?.templateId ?? body.templateId ?? "").trim(),
    sendToWA: nested?.sendToWA ?? body.sendToWA ?? true,
    inboxType: nested?.inboxType ?? body.inboxType ?? "human",
    components: nested?.components ?? body.components,
  };
}

export function phoneDigitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function extractTemplateBodyParametersFromMetaComponents(components: unknown[] | undefined): string[] {
  if (!components?.length) return [];
  const body = components.find(
    (c) => typeof c === "object" && c !== null && String((c as { type?: string }).type ?? "").toLowerCase() === "body",
  ) as { parameters?: Array<{ type?: string; text?: string }> } | undefined;
  if (!body?.parameters?.length) return [];
  return body.parameters
    .filter((p) => String(p.type ?? "text").toLowerCase() === "text" && typeof p.text === "string")
    .map((p) => p.text!);
}

export function sanitizeMetaTemplateComponentsForSend(
  components: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return components.map((comp) => {
    const type = String(comp.type ?? "").toLowerCase();
    const params = Array.isArray(comp.parameters) ? comp.parameters : [];
    const sanitizedParams = params.map((p) => {
      if (typeof p !== "object" || p === null) return p;
      const param = p as Record<string, unknown>;
      const pType = String(param.type ?? "text").toLowerCase();
      if (pType === "text") {
        return { type: "text", text: String(param.text ?? "") };
      }
      return param;
    });
    const out: Record<string, unknown> = { type, parameters: sanitizedParams };
    if (comp.sub_type != null) out.sub_type = comp.sub_type;
    if (comp.index !== undefined) out.index = comp.index;
    return out;
  });
}
