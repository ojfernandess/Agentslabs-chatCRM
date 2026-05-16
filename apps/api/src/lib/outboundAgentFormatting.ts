import { prisma } from "../db.js";

/**
 * Prefixo WhatsApp (*bold*) com o nome do atendente — só para envio ao canal externo.
 * O corpo guardado na BD mantém-se sem este prefixo para o painel não duplicar o cabeçalho.
 */
export async function prefixOutboundBodyForExternalChannel(
  organizationId: string,
  userId: string,
  body: string | null | undefined,
  isPrivate: boolean,
): Promise<string> {
  const trimmed = (body ?? "").trim();
  if (isPrivate) return trimmed;

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { name: true, displayName: true, showAgentNameInChat: true },
  });
  if (!user?.showAgentNameInChat) return trimmed;

  const label = user.displayName?.trim() || user.name?.trim();
  if (!label) return trimmed;

  const prefix = `*${label}*`;
  if (trimmed.startsWith(prefix)) return trimmed;
  return trimmed ? `${prefix}\n${trimmed}` : prefix;
}
