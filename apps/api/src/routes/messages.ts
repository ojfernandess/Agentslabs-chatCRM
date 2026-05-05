import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { WHATSAPP_SESSION_WINDOW_HOURS } from "@openconduit/shared";
import { getWhatsAppProvider } from "../providers/factory.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

const sendMessageSchema = z.object({
  contactId: z.string().uuid(),
  type: z.enum(["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "TEMPLATE"]),
  body: z.string().max(4096).optional(),
  templateId: z.string().uuid().optional(),
  mediaUrl: z.string().url().optional(),
});

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const { contactId, type, body, templateId, mediaUrl } = parsed.data;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId },
    });
    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    if (type !== "TEMPLATE") {
      const lastInbound = await prisma.message.findFirst({
        where: {
          conversation: { contactId, organizationId },
          direction: "INBOUND",
        },
        orderBy: { createdAt: "desc" },
      });

      if (lastInbound) {
        const hoursSinceLastInbound =
          (Date.now() - lastInbound.createdAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastInbound > WHATSAPP_SESSION_WINDOW_HOURS) {
          return reply.status(422).send({
            error: "Unprocessable Entity",
            message: "Outside 24-hour session window. Only template messages can be sent.",
            statusCode: 422,
          });
        }
      }
    }

    let conversation = await prisma.conversation.findFirst({
      where: { organizationId, contactId, status: { not: "RESOLVED" } },
      orderBy: { updatedAt: "desc" },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          organizationId,
          contactId,
          status: "OPEN",
          assignedToId: request.user.id,
        },
      });
    }

    let messageBody = body;
    if (type === "TEMPLATE" && templateId) {
      const template = await prisma.messageTemplate.findFirst({
        where: { id: templateId, organizationId },
      });
      if (!template) {
        return reply.status(404).send({ error: "Not Found", message: "Template not found", statusCode: 404 });
      }
      messageBody = template.body;
    }

    let providerMsgId: string | undefined;
    try {
      const provider = await getWhatsAppProvider(organizationId);
      if (provider) {
        providerMsgId = await provider.sendMessage({
          to: contact.phone,
          type,
          body: messageBody,
          mediaUrl,
        });
      }
    } catch (err) {
      app.log.error(err, "Failed to send message via WhatsApp provider");
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        type,
        body: messageBody,
        mediaUrl,
        providerMsgId,
        status: providerMsgId ? "SENT" : "FAILED",
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return reply.status(201).send(message);
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const message = await prisma.message.findFirst({
      where: {
        id: request.params.id,
        conversation: { organizationId },
      },
      include: { conversation: { include: { contact: true } } },
    });

    if (!message) {
      return reply.status(404).send({ error: "Not Found", message: "Message not found", statusCode: 404 });
    }

    return message;
  });
}
