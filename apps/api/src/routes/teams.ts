import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { TeamMemberRole, Prisma } from "@prisma/client";
import { getUnseenTeamTransferCounts } from "../lib/teamTransferUnread.js";

const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  avatarUrl: z.string().url().max(2048).optional(),
  businessHours: z.record(z.unknown()).optional(),
  notificationSettings: z.record(z.unknown()).optional(),
});

const patchTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).nullable().optional(),
  avatarUrl: z.string().url().max(2048).optional(),
  businessHours: z.union([z.record(z.unknown()), z.null()]).optional(),
  notificationSettings: z.record(z.unknown()).optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.nativeEnum(TeamMemberRole),
});

const patchMemberSchema = z.object({
  role: z.nativeEnum(TeamMemberRole),
});

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (request.user.role === "AGENT") {
      const rows = await prisma.team.findMany({
        where: {
          organizationId,
          members: { some: { userId: request.user.id } },
        },
        select: {
          id: true,
          name: true,
          description: true,
          avatarUrl: true,
          updatedAt: true,
          _count: { select: { members: true } },
        },
        orderBy: { name: "asc" },
      });
      const teamIds = rows.map((r) => r.id);
      const unseen = await getUnseenTeamTransferCounts(prisma, organizationId, request.user.id, teamIds);
      return {
        data: rows.map((r) => ({
          ...r,
          unseenTransferCount: unseen.get(r.id) ?? 0,
        })),
      };
    }

    const rows = await prisma.team.findMany({
      where: { organizationId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        _count: { select: { members: true, conversations: true } },
      },
      orderBy: { name: "asc" },
    });
    const teamIds = rows.map((r) => r.id);
    const unseen = await getUnseenTeamTransferCounts(prisma, organizationId, request.user.id, teamIds);
    return {
      data: rows.map((r) => ({
        ...r,
        unseenTransferCount: unseen.get(r.id) ?? 0,
      })),
    };
  });

  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = createTeamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const data: Prisma.TeamCreateInput = {
      organization: { connect: { id: organizationId } },
      name: parsed.data.name,
      description: parsed.data.description,
      avatarUrl: parsed.data.avatarUrl,
      businessHours: parsed.data.businessHours as Prisma.InputJsonValue | undefined,
      notificationSettings: parsed.data.notificationSettings as Prisma.InputJsonValue | undefined,
    };
    const team = await prisma.team.create({ data });

    const agents = await prisma.user.findMany({
      where: { organizationId, role: "AGENT" },
      select: { id: true },
    });
    if (agents.length > 0) {
      await prisma.teamMember.createMany({
        data: agents.map((u) => ({
          teamId: team.id,
          userId: u.id,
          role: TeamMemberRole.MEMBER,
        })),
        skipDuplicates: true,
      });
    }

    return reply.status(201).send(team);
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const team = await prisma.team.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        _count: { select: { members: true, conversations: true } },
      },
    });
    if (!team) {
      return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
    }
    if (request.user.role === "AGENT") {
      const isMember = team.members.some((m) => m.userId === request.user.id);
      if (!isMember) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }
    return team;
  });

  app.patch<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = patchTeamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const existing = await prisma.team.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
    }
    const data: Prisma.TeamUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.avatarUrl !== undefined) data.avatarUrl = parsed.data.avatarUrl;
    if (parsed.data.businessHours !== undefined) {
      data.businessHours =
        parsed.data.businessHours === null
          ? Prisma.JsonNull
          : (parsed.data.businessHours as Prisma.InputJsonValue);
    }
    if (parsed.data.notificationSettings !== undefined) {
      data.notificationSettings = parsed.data.notificationSettings as object;
    }
    return prisma.team.update({ where: { id: existing.id }, data });
  });

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const res = await prisma.team.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/members", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = addMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const team = await prisma.team.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!team) {
      return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
    }
    const user = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId },
    });
    if (!user) {
      return reply.status(400).send({ error: "Bad Request", message: "User not in organization", statusCode: 400 });
    }
    try {
      const row = await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: user.id,
          role: parsed.data.role,
        },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      });
      return reply.status(201).send(row);
    } catch {
      return reply.status(409).send({ error: "Conflict", message: "User already in team", statusCode: 409 });
    }
  });

  app.patch<{ Params: { id: string; userId: string } }>(
    "/:id/members/:userId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const parsed = patchMemberSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }
      const team = await prisma.team.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!team) {
        return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
      }
      const res = await prisma.teamMember.updateMany({
        where: { teamId: team.id, userId: request.params.userId },
        data: { role: parsed.data.role },
      });
      if (res.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Member not found", statusCode: 404 });
      }
      return prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: request.params.userId },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      });
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/:id/members/:userId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const team = await prisma.team.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!team) {
        return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
      }
      const res = await prisma.teamMember.deleteMany({
        where: { teamId: team.id, userId: request.params.userId },
      });
      if (res.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Member not found", statusCode: 404 });
      }
      return reply.status(204).send();
    },
  );
}
