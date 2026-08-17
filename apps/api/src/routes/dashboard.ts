import { FastifyInstance } from "fastify";
import { startOfDay, subDays, format } from "date-fns";
import { prisma } from "../db.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { loadConversationInboxVisibilityWhere } from "../lib/conversationInboxVisibility.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => {
    await request.jwtVerify();
  });

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const now = new Date();
    const todayStart = startOfDay(now);
    const weekAgoStart = startOfDay(subDays(now, 7));

    const visibleConversations = await loadConversationInboxVisibilityWhere({
      organizationId,
      userId: request.user.id,
      role: request.user.role,
    });

    const [
      openConversations,
      pendingConversations,
      totalContacts,
      remindersDueToday,
      pipelineStats,
      tagStats,
      messageStats,
      recentConversations,
    ] = await Promise.all([
      prisma.conversation.count({ where: { ...visibleConversations, status: "OPEN" } }),
      prisma.conversation.count({ where: { ...visibleConversations, status: "PENDING" } }),
      prisma.contact.count({ where: { organizationId } }),
      prisma.reminder.count({
        where: {
          organizationId,
          userId: request.user.id,
          dueAt: { gte: todayStart, lt: startOfDay(subDays(todayStart, -1)) },
          completed: false,
        },
      }),
      prisma.pipelineStage.findMany({
        where: { pipeline: { organizationId, isDefault: true } },
        include: { _count: { select: { contacts: true } } },
        orderBy: { order: "asc" },
      }),
      prisma.tag.findMany({
        where: { organizationId },
        include: { _count: { select: { contacts: true } } },
        orderBy: { contacts: { _count: "desc" } },
        take: 5,
      }),
      prisma.message.groupBy({
        by: ["direction", "createdAt"],
        where: {
          createdAt: { gte: weekAgoStart },
          conversation: { organizationId },
        },
        _count: true,
      }),
      prisma.conversation.findMany({
        where: { ...visibleConversations, status: "OPEN" },
        take: 5,
        orderBy: { updatedAt: "desc" },
        include: {
          contact: {
            select: { name: true, phone: true },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { body: true, createdAt: true },
          },
        },
      }),
    ]);

    const messageVolume = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(todayStart, 6 - i);
      const dateStr = format(date, "MMM dd");

      const dayMessages = messageStats.filter(
        (m) => startOfDay(new Date(m.createdAt)).getTime() === date.getTime(),
      );

      return {
        name: dateStr,
        inbound: dayMessages
          .filter((m) => m.direction === "INBOUND")
          .reduce((acc, m) => acc + m._count, 0),
        outbound: dayMessages
          .filter((m) => m.direction === "OUTBOUND")
          .reduce((acc, m) => acc + m._count, 0),
      };
    });

    return {
      stats: {
        openConversations,
        pendingConversations,
        totalContacts,
        remindersDueToday,
      },
      pipeline: pipelineStats.map((s) => ({
        name: s.name,
        value: s._count.contacts,
      })),
      tags: tagStats.map((t) => ({
        name: t.name,
        value: t._count.contacts,
      })),
      messageVolume,
      recentConversations: recentConversations.map((c) => ({
        id: c.id,
        contactName: c.contact.name,
        phone: c.contact.phone,
        lastMessage: c.messages[0]?.body ?? "No messages",
        time: c.messages[0]?.createdAt ?? c.updatedAt,
      })),
    };
  });
}
