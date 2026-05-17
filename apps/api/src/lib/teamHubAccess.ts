import type { FastifyReply } from "fastify";
import { prisma } from "../db.js";
import type { JwtPayload } from "../middleware/auth.js";
import { isOrganizationFeatureEnabled, type FeatureFlagKey } from "./featureFlags.js";

export async function requireTeamHubFeature(
  organizationId: string,
  key: FeatureFlagKey,
  reply: FastifyReply,
): Promise<boolean> {
  const enabled = await isOrganizationFeatureEnabled(organizationId, key);
  if (!enabled) {
    reply.status(403).send({
      error: "Forbidden",
      message: "This team collaboration feature is not enabled for your organization",
      statusCode: 403,
    });
    return false;
  }
  return true;
}

export async function loadTeamForHub(
  teamId: string,
  organizationId: string,
  user: JwtPayload,
): Promise<
  | {
      id: string;
      name: string;
      description: string | null;
      members: { userId: string }[];
    }
  | null
> {
  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId },
    select: {
      id: true,
      name: true,
      description: true,
      members: { select: { userId: true } },
    },
  });
  if (!team) return null;
  if (user.role === "AGENT") {
    const isMember = team.members.some((m) => m.userId === user.id);
    if (!isMember) return null;
  }
  return team;
}
