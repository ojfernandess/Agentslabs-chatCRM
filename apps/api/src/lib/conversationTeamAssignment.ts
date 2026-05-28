import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

export const assignConversationTeamBodySchema = z.object({
  teamId: z.string().uuid().nullable(),
  assignedToId: z.string().uuid().nullable().optional(),
});

export type AssignConversationTeamBody = z.infer<typeof assignConversationTeamBodySchema>;

export type AssignConversationTeamError = { status: 400 | 404; message: string };

export async function assignConversationTeamForOrg(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    conversationId: string;
    body: AssignConversationTeamBody;
  },
): Promise<
  | {
      ok: true;
      payload: {
        id: string;
        teamId: string | null;
        assignedToId: string | null;
        team: { id: string; name: string } | null;
        assignedTo: { id: string; name: string } | null;
      };
    }
  | { ok: false; error: AssignConversationTeamError }
> {
  const { organizationId, conversationId, body } = params;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { id: true, teamId: true },
  });
  if (!conversation) {
    return { ok: false, error: { status: 404, message: "Conversation not found" } };
  }
  const prevTeamId = conversation.teamId;

  if (body.teamId) {
    const team = await prisma.team.findFirst({
      where: { id: body.teamId, organizationId },
      select: { id: true },
    });
    if (!team) {
      return { ok: false, error: { status: 400, message: "Invalid teamId" } };
    }
  }

  if (body.assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: body.assignedToId, organizationId },
      select: { id: true },
    });
    if (!assignee) {
      return { ok: false, error: { status: 400, message: "Invalid assignedToId" } };
    }
    if (body.teamId) {
      const member = await prisma.teamMember.findFirst({
        where: { teamId: body.teamId, userId: body.assignedToId },
        select: { userId: true },
      });
      if (!member) {
        return {
          ok: false,
          error: { status: 400, message: "Assignee must be a member of teamId" },
        };
      }
    }
  }

  const teamPulse =
    body.teamId !== prevTeamId ? { teamTransferPulseAt: body.teamId ? new Date() : null } : {};

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      teamId: body.teamId,
      ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}),
      ...(body.assignedToId ? { awaitingHumanHandoff: false } : {}),
      ...teamPulse,
    },
    include: {
      team: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  return {
    ok: true,
    payload: {
      id: updated.id,
      teamId: updated.teamId,
      assignedToId: updated.assignedToId,
      team: updated.team,
      assignedTo: updated.assignedTo,
    },
  };
}
