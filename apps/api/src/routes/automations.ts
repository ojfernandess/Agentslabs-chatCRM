import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticateSessionOrUserApiTokenForApplicationApis } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  assignConversationTeamBodySchema,
  assignConversationTeamForOrg,
} from "../lib/conversationTeamAssignment.js";
import { assignTagsToConversationContact } from "../lib/assignContactTags.js";

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

    const result = await assignTagsToConversationContact(prisma, {
      organizationId,
      conversationId: request.params.id,
      tagIds: parsed.data.tagIds,
      mode: parsed.data.mode,
    });
    if (!result.ok) {
      if (result.error === "conversation_not_found") {
        return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
      }
      return reply.status(400).send({ error: "Bad Request", message: result.error, statusCode: 400 });
    }
    return {
      conversationId: request.params.id,
      contactId: result.contactId,
      tags: result.tags,
    };
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
