import { TeamMemberRole } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Agente com pelo menos uma equipa na organização — aplica-se escopo restrito na API
 * (conversas das equipas + atribuídas ao utilizador; contactos só os atribuídos a si no CRM lista).
 *
 * Agente **sem** equipas vê o tenant completo nas listagens (evita ecrã vazio para contas novas até
 * um administrador as adicionar a equipas).
 */
export async function agentIsTeamScoped(userId: string, organizationId: string): Promise<boolean> {
  const row = await prisma.teamMember.findFirst({
    where: { userId, team: { organizationId } },
    select: { id: true },
  });
  return !!row;
}

/**
 * Coloca o utilizador como membro (MEMBER) de todas as equipas do tenant.
 * Idempotente. Útil ao criar/promover agentes para já herdarem conversas das equipas existentes.
 */
export async function addAgentToAllOrganizationTeams(organizationId: string, userId: string): Promise<void> {
  const teams = await prisma.team.findMany({
    where: { organizationId },
    select: { id: true },
  });
  if (teams.length === 0) return;

  await prisma.teamMember.createMany({
    data: teams.map((t) => ({
      teamId: t.id,
      userId,
      role: TeamMemberRole.MEMBER,
    })),
    skipDuplicates: true,
  });
}
