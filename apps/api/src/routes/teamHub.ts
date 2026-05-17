import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { loadTeamForHub, requireTeamHubFeature } from "../lib/teamHubAccess.js";
import type { JwtPayload } from "../middleware/auth.js";
import { TeamChannelKind, TeamWorkspaceItemType } from "@prisma/client";
import {
  getAssistOpenAiCredentialsForOrganization,
  assistOpenAiModel,
  buildPublicConversationTranscript,
} from "../lib/agentAssistLlm.js";
import { callOpenAiCompatibleChat } from "../lib/promptModulePreviewLlm.js";

async function ensureDefaultChannel(teamId: string, organizationId: string) {
  const count = await prisma.teamChannel.count({ where: { teamId } });
  if (count > 0) return;
  await prisma.teamChannel.create({
    data: {
      teamId,
      organizationId,
      name: "geral",
      description: "Canal principal da equipa",
      kind: TeamChannelKind.GENERAL,
    },
  });
}

export async function teamHubRoutes(app: FastifyInstance): Promise<void> {
  const hubGuard = async (
    organizationId: string,
    teamId: string,
    user: JwtPayload,
    reply: FastifyReply,
  ) => {
    if (!(await requireTeamHubFeature(organizationId, "teams_collaboration_hub", reply))) return null;
    const team = await loadTeamForHub(teamId, organizationId, user);
    if (!team) {
      reply.status(404).send({ error: "Not Found", message: "Team not found", statusCode: 404 });
      return null;
    }
    return team;
  };

  app.get<{ Params: { id: string } }>("/:id/hub/overview", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    const teamId = team.id;
    const [statusCounts, recentConversations, members, channelCount, workspaceCount, recentMessages] =
      await Promise.all([
        prisma.conversation.groupBy({
          by: ["status"],
          where: { teamId, organizationId },
          _count: { _all: true },
        }),
        prisma.conversation.findMany({
          where: { teamId, organizationId },
          orderBy: { updatedAt: "desc" },
          take: 8,
          select: {
            id: true,
            status: true,
            updatedAt: true,
            contact: { select: { id: true, name: true } },
            assignedTo: { select: { id: true, name: true } },
          },
        }),
        prisma.teamMember.findMany({
          where: { teamId },
          include: { user: { select: { id: true, name: true, displayName: true, email: true } } },
        }),
        prisma.teamChannel.count({ where: { teamId } }),
        prisma.teamWorkspaceItem.count({ where: { teamId } }),
        prisma.teamChannelMessage.findMany({
          where: { channel: { teamId } },
          orderBy: { createdAt: "desc" },
          take: 12,
          include: {
            authorUser: { select: { id: true, name: true, displayName: true } },
            channel: { select: { id: true, name: true } },
          },
        }),
      ]);

    const byStatus: Record<string, number> = { OPEN: 0, PENDING: 0, RESOLVED: 0 };
    for (const row of statusCounts) {
      byStatus[row.status] = row._count._all;
    }

    return {
      team: { id: team.id, name: team.name, description: team.description },
      stats: {
        conversations: byStatus,
        channelCount,
        workspaceCount,
        memberCount: members.length,
      },
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        user: m.user,
      })),
      recentConversations,
      recentChannelActivity: recentMessages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        channel: m.channel,
        author: {
          id: m.authorUser.id,
          name: m.authorUser.displayName?.trim() || m.authorUser.name,
        },
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/:id/channels", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireTeamHubFeature(organizationId, "teams_channels", reply))) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    await ensureDefaultChannel(team.id, organizationId);

    const channels = await prisma.teamChannel.findMany({
      where: { teamId: team.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, body: true },
        },
      },
    });

    return {
      data: channels.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        kind: c.kind,
        messageCount: c._count.messages,
        lastMessage: c.messages[0] ?? null,
      })),
    };
  });

  const channelBodySchema = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(2000).optional(),
    kind: z.nativeEnum(TeamChannelKind).optional(),
  });

  app.post<{ Params: { id: string } }>("/:id/channels", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireTeamHubFeature(organizationId, "teams_channels", reply))) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    const parsed = channelBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const name = parsed.data.name.trim().toLowerCase().replace(/\s+/g, "-");
    try {
      const channel = await prisma.teamChannel.create({
        data: {
          teamId: team.id,
          organizationId,
          name,
          description: parsed.data.description,
          kind: parsed.data.kind ?? TeamChannelKind.GENERAL,
        },
      });
      return reply.status(201).send(channel);
    } catch {
      return reply.status(409).send({ error: "Conflict", message: "Channel name already exists", statusCode: 409 });
    }
  });

  app.get<{ Params: { id: string; channelId: string } }>("/:id/channels/:channelId/messages", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireTeamHubFeature(organizationId, "teams_channels", reply))) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    const channel = await prisma.teamChannel.findFirst({
      where: { id: request.params.channelId, teamId: team.id },
    });
    if (!channel) {
      return reply.status(404).send({ error: "Not Found", message: "Channel not found", statusCode: 404 });
    }

    const messages = await prisma.teamChannelMessage.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: {
        authorUser: { select: { id: true, name: true, displayName: true } },
      },
    });

    return {
      data: messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        author: {
          id: m.authorUser.id,
          name: m.authorUser.displayName?.trim() || m.authorUser.name,
        },
      })),
    };
  });

  app.post<{ Params: { id: string; channelId: string } }>(
    "/:id/channels/:channelId/messages",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!(await requireTeamHubFeature(organizationId, "teams_channels", reply))) return;
      const team = await hubGuard(organizationId, request.params.id, request.user, reply);
      if (!team) return;

      const parsed = z.object({ body: z.string().min(1).max(16000) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const channel = await prisma.teamChannel.findFirst({
        where: { id: request.params.channelId, teamId: team.id },
      });
      if (!channel) {
        return reply.status(404).send({ error: "Not Found", message: "Channel not found", statusCode: 404 });
      }

      const message = await prisma.teamChannelMessage.create({
        data: {
          channelId: channel.id,
          authorUserId: request.user.id,
          body: parsed.data.body.trim(),
        },
        include: {
          authorUser: { select: { id: true, name: true, displayName: true } },
        },
      });

      return reply.status(201).send({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        author: {
          id: message.authorUser.id,
          name: message.authorUser.displayName?.trim() || message.authorUser.name,
        },
      });
    },
  );

  const workspaceSchema = z.object({
    itemType: z.nativeEnum(TeamWorkspaceItemType),
    title: z.string().min(1).max(200),
    content: z.string().max(50000).optional(),
    fileUrl: z.string().url().max(2048).optional(),
    pinned: z.boolean().optional(),
  });

  app.get<{ Params: { id: string }; Querystring: { type?: string } }>("/:id/workspace", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireTeamHubFeature(organizationId, "teams_workspace", reply))) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    const typeFilter = request.query.type;
    const items = await prisma.teamWorkspaceItem.findMany({
      where: {
        teamId: team.id,
        ...(typeFilter && Object.values(TeamWorkspaceItemType).includes(typeFilter as TeamWorkspaceItemType)
          ? { itemType: typeFilter as TeamWorkspaceItemType }
          : {}),
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      include: {
        createdBy: { select: { id: true, name: true, displayName: true } },
      },
    });

    return {
      data: items.map((i) => ({
        id: i.id,
        itemType: i.itemType,
        title: i.title,
        content: i.content,
        fileUrl: i.fileUrl,
        pinned: i.pinned,
        updatedAt: i.updatedAt,
        createdBy: {
          id: i.createdBy.id,
          name: i.createdBy.displayName?.trim() || i.createdBy.name,
        },
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/:id/workspace", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireTeamHubFeature(organizationId, "teams_workspace", reply))) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    const parsed = workspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const item = await prisma.teamWorkspaceItem.create({
      data: {
        teamId: team.id,
        organizationId,
        itemType: parsed.data.itemType,
        title: parsed.data.title.trim(),
        content: parsed.data.content?.trim() || null,
        fileUrl: parsed.data.fileUrl ?? null,
        pinned: parsed.data.pinned ?? false,
        createdById: request.user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true, displayName: true } },
      },
    });

    return reply.status(201).send(item);
  });

  app.delete<{ Params: { id: string; itemId: string } }>("/:id/workspace/:itemId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireTeamHubFeature(organizationId, "teams_workspace", reply))) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    const res = await prisma.teamWorkspaceItem.deleteMany({
      where: { id: request.params.itemId, teamId: team.id },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Item not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/hub/ai", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireTeamHubFeature(organizationId, "teams_ai_copilot", reply))) return;
    const team = await hubGuard(organizationId, request.params.id, request.user, reply);
    if (!team) return;

    const parsed = z.object({ prompt: z.string().min(1).max(4000) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const creds = await getAssistOpenAiCredentialsForOrganization(organizationId);
    if (!creds) {
      return reply.status(503).send({
        error: "Service Unavailable",
        message: "OpenAI API key not configured",
        statusCode: 503,
      });
    }

    const [openCount, pendingCount, recentConvos] = await Promise.all([
      prisma.conversation.count({ where: { teamId: team.id, status: "OPEN" } }),
      prisma.conversation.count({ where: { teamId: team.id, status: "PENDING" } }),
      prisma.conversation.findMany({
        where: { teamId: team.id },
        orderBy: { updatedAt: "desc" },
        take: 3,
        include: {
          contact: { select: { name: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 6 },
        },
      }),
    ]);

    const snippets = recentConvos
      .map((c) => {
        const transcript = buildPublicConversationTranscript(
          c.messages.map((m) => ({
            direction: m.direction,
            body: m.body,
            isPrivate: m.isPrivate,
          })),
          6,
        );
        return `Conversa com ${c.contact.name} (${c.status}):\n${transcript}`;
      })
      .join("\n\n");

    const system = [
      "És copiloto operacional de uma equipa de atendimento num CRM.",
      `Equipa: ${team.name}.`,
      `Métricas: ${openCount} abertas, ${pendingCount} pendentes.`,
      "Responde em português, de forma concisa e acionável para supervisores e agentes.",
    ].join("\n");

    const userContent = [
      snippets ? `Contexto recente:\n${snippets}` : "Sem conversas recentes.",
      `Pedido do utilizador:\n${parsed.data.prompt}`,
    ].join("\n\n");

    const { text } = await callOpenAiCompatibleChat({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      model: assistOpenAiModel(),
      temperature: 0.4,
      maxTokens: 900,
      system,
      history: [],
      userMessage: userContent,
    });

    return { answer: text.trim() };
  });
}
