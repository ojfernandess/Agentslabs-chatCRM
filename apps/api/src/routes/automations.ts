import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticateSessionOrUserApiTokenForApplicationApis } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  assignConversationTeamBodySchema,
  assignConversationTeamForOrg,
} from "../lib/conversationTeamAssignment.js";

const assignConversationTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(["replace", "add"]).optional().default("replace"),
});

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticateSessionOrUserApiTokenForApplicationApis);

  app.get("/tags", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const tags = await prisma.tag.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
    return { data: tags };
  });

  app.get("/teams", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (request.user.role === "AGENT") {
      const teams = await prisma.team.findMany({
        where: { organizationId, members: { some: { userId: request.user.id } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true, _count: { select: { members: true } } },
      });
      return { data: teams };
    }

    const teams = await prisma.team.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, _count: { select: { members: true } } },
    });
    return { data: teams };
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/tags", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required for automation tag assignment",
        statusCode: 403,
      });
    }

    const parsed = assignConversationTagsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true, contactId: true },
    });
    if (!conversation) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    const existingTags = await prisma.tag.findMany({
      where: { organizationId, id: { in: parsed.data.tagIds } },
      select: { id: true },
    });
    if (existingTags.length !== parsed.data.tagIds.length) {
      return reply.status(400).send({ error: "Bad Request", message: "One or more tagIds are invalid", statusCode: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (parsed.data.mode === "replace") {
        await tx.contactTag.deleteMany({ where: { contactId: conversation.contactId } });
      }
      await tx.contactTag.createMany({
        data: parsed.data.tagIds.map((tagId) => ({ contactId: conversation.contactId, tagId })),
        skipDuplicates: true,
      });
    });

    const contactTags = await prisma.contactTag.findMany({
      where: { contactId: conversation.contactId },
      orderBy: { tagId: "asc" },
    });
    const tags = await prisma.tag.findMany({
      where: { id: { in: contactTags.map((ct) => ct.tagId) }, organizationId },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    });
    return { conversationId: conversation.id, contactId: conversation.contactId, tags };
  });

  app.patch<{ Params: { id: string } }>("/conversations/:id/team", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required for automation team assignment",
        statusCode: 403,
      });
    }

    const parsed = assignConversationTeamBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const result = await assignConversationTeamForOrg(prisma, {
      organizationId,
      conversationId: request.params.id,
      body: parsed.data,
    });
    if (!result.ok) {
      return reply.status(result.error.status).send({
        error: result.error.status === 404 ? "Not Found" : "Bad Request",
        message: result.error.message,
        statusCode: result.error.status,
      });
    }
    return result.payload;
  });
}
