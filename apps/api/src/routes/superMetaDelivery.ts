import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  getSuperMetaDeliveryDiagnostics,
  inspectSuperMetaDeliveryConversation,
} from "../lib/superMetaDeliveryDiagnostics.js";
import { requireSuperAdmin } from "../middleware/auth.js";

const orgInboxQuerySchema = z.object({
  organizationId: z.string().uuid(),
  inboxId: z.string().uuid().optional(),
});

const conversationQuerySchema = z.object({
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid(),
  inboxId: z.string().uuid().optional(),
  errorsOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

export async function superMetaDeliveryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get("/meta-delivery/diagnostics", async (request, reply) => {
    const parsed = orgInboxQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { id: true, name: true },
    });
    if (!org) {
      return reply.status(404).send({
        error: "Not Found",
        message: "Organization not found",
        statusCode: 404,
      });
    }

    const result = await getSuperMetaDeliveryDiagnostics(parsed.data);
    return {
      organization: org,
      ...result,
    };
  });

  app.get("/meta-delivery/conversation", async (request, reply) => {
    const parsed = conversationQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    try {
      const inspection = await inspectSuperMetaDeliveryConversation(parsed.data);
      return inspection;
    } catch (err) {
      if (err instanceof Error && err.message === "CONVERSATION_NOT_FOUND") {
        return reply.status(404).send({
          error: "Not Found",
          message: "Conversation not found for this organization/inbox",
          statusCode: 404,
        });
      }
      throw err;
    }
  });
}
