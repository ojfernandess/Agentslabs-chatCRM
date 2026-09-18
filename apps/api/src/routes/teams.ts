import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { TeamMemberRole, TeamPurpose, Prisma } from "@prisma/client";
import { getUnseenTeamTransferCounts } from "../lib/teamTransferUnread.js";
import { availabilityToClient } from "../lib/userAvailability.js";
import { enrichUsersWithOpenCounts, openConversationCountByUserId } from "../lib/assignableUsers.js";
import { teamHubRoutes } from "./teamHub.js";
import { getOrCreateOrgCollaborationTeam } from "../lib/orgCollaborationTeam.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";

const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  avatarUrl: z.string().url().max(2048).optional(),
  businessHours: z.record(z.unknown()).optional(),
  notificationSettings: z.record(z.unknown()).optional(),
  purpose: z.nativeEnum(TeamPurpose).optional(),
});

function teamListWhere(
  organizationId: string,
  options: { operationalOnly?: boolean; agentUserId?: string },
): Prisma.TeamWhereInput {
  const where: Prisma.TeamWhereInput = { organizationId };
  if (options.operationalOnly) {
    where.purpose = TeamPurpose.OPERATIONAL;
    where.isOrgCollaborationSpace = false;
  }
  if (options.agentUserId) {
    where.members = { some: { userId: options.agentUserId } };
  }
  return where;
}

const teamListSelect = {
  id: true,
  name: true,
  description: true,
  avatarUrl: true,
  purpose: true,
  isOrgCollaborationSpace: true,
  updatedAt: true,
  _count: { select: { members: true, conversations: true } },
} as const;

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

  await app.register(teamHubRoutes);

  app.get("/collaboration/workspace", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const [hubOn, channelsOn, workspaceOn] = await Promise.all([
      isOrganizationFeatureEnabled(organizationId, "teams_collaboration_hub"),
      isOrganizationFeatureEnabled(organizationId, "teams_channels"),
      isOrganizationFeatureEnabled(organizationId, "teams_workspace"),
    ]);
    if (!hubOn && !channelsOn && !workspaceOn) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Collaboration hub features are not enabled for this organization",
        statusCode: 403,
      });
    }

    const team = await getOrCreateOrgCollaborationTeam(organizationId);
    return { data: team };
  });

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const operationalOnly =
      (request.query as { operationalOnly?: string }).operationalOnly === "1" ||
      (request.query as { operationalOnly?: string }).operationalOnly === "true";

    if (request.user.role === "AGENT") {
      const rows = await prisma.team.findMany({
        where: teamListWhere(organizationId, {
          operationalOnly,
          agentUserId: request.user.id,
        }),
        select: teamListSelect,
        orderBy: [{ isOrgCollaborationSpace: "desc" }, { name: "asc" }],
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
      where: teamListWhere(organizationId, { operationalOnly }),
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        _count: { select: { members: true, conversations: true } },
      },
      orderBy: [{ isOrgCollaborationSpace: "desc" }, { name: "asc" }],
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
    const purpose = parsed.data.purpose ?? TeamPurpose.OPERATIONAL;
    const data: Prisma.TeamCreateInput = {
      organization: { connect: { id: organizationId } },
      name: parsed.data.name,
      description: parsed.data.description,
      avatarUrl: parsed.data.avatarUrl,
      businessHours: parsed.data.businessHours as Prisma.InputJsonValue | undefined,
      notificationSettings: parsed.data.notificationSettings as Prisma.InputJsonValue | undefined,
      purpose,
      isOrgCollaborationSpace: false,
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
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatarUrl: true,
                availabilityStatus: true,
                availabilityUpdatedAt: true,
              },
            },
          },
        },
        _count: { select: { members: true, conversations: true } },
      },
    });
    if (!team) {
      return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
    }
    if (request.user.role === "AGENT" && !team.isOrgCollaborationSpace) {
      const isMember = team.members.some((m) => m.userId === request.user.id);
      if (!isMember) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }
    const memberUserIds = team.members.map((m) => m.userId);
    const countMap = await openConversationCountByUserId(organizationId, memberUserIds);
    return {
      ...team,
      members: team.members.map((member) => {
        const enriched = enrichUsersWithOpenCounts([member.user], countMap)[0];
        return {
          ...member,
          user: {
            ...enriched,
            availabilityStatus: availabilityToClient(member.user.availabilityStatus),
            availabilityUpdatedAt: member.user.availabilityUpdatedAt?.toISOString() ?? null,
          },
        };
      }),
    };
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
    if (parsed.data.name !== undefined && !existing.isOrgCollaborationSpace) data.name = parsed.data.name;
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
    const existing = await prisma.team.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
    }
    if (existing.isOrgCollaborationSpace) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "The organization collaboration workspace cannot be deleted",
        statusCode: 403,
      });
    }
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
