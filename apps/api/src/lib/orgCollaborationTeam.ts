import { TeamMemberRole, TeamPurpose } from "@prisma/client";
import { prisma } from "../db.js";

export const ORG_COLLABORATION_TEAM_NAME = "Colaboração";

export async function syncOrgCollaborationTeamMembers(organizationId: string, teamId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, role: true },
  });
  if (users.length === 0) return;

  await prisma.teamMember.createMany({
    data: users.map((user) => ({
      teamId,
      userId: user.id,
      role: user.role === "ADMIN" ? TeamMemberRole.TEAM_ADMIN : TeamMemberRole.MEMBER,
    })),
    skipDuplicates: true,
  });
}

export async function getOrCreateOrgCollaborationTeam(organizationId: string) {
  const existing = await prisma.team.findFirst({
    where: { organizationId, isOrgCollaborationSpace: true },
    select: {
      id: true,
      name: true,
      description: true,
      purpose: true,
      isOrgCollaborationSpace: true,
      updatedAt: true,
      _count: { select: { members: true, conversations: true } },
    },
  });
  if (existing) {
    await syncOrgCollaborationTeamMembers(organizationId, existing.id);
    return existing;
  }

  const team = await prisma.team.create({
    data: {
      organizationId,
      name: ORG_COLLABORATION_TEAM_NAME,
      description: "Espaço de colaboração da organização (visão geral, canais e workspace).",
      purpose: TeamPurpose.COMMUNICATION,
      isOrgCollaborationSpace: true,
    },
    select: {
      id: true,
      name: true,
      description: true,
      purpose: true,
      isOrgCollaborationSpace: true,
      updatedAt: true,
      _count: { select: { members: true, conversations: true } },
    },
  });

  await syncOrgCollaborationTeamMembers(organizationId, team.id);
  return team;
}
