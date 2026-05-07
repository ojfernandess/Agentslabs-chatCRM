import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../db.js";

const TOKEN_PREFIX = "ocb_";

declare module "fastify" {
  interface FastifyRequest {
    agentBot?: { id: string; organizationId: string; name: string };
  }
}

/** Autenticação Bearer para o Agent Bot responder via HTTP (token `ocb_...`). */
export async function authenticateAgentBot(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const raw = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length < TOKEN_PREFIX.length + 16) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Invalid or missing agent bot token (use Bearer ocb_...)",
      statusCode: 401,
    });
    return;
  }

  const prefix = raw.slice(0, 12);
  const candidates = await prisma.bot.findMany({
    where: { inboxTokenPrefix: prefix, isActive: true },
    select: { id: true, name: true, organizationId: true, inboxTokenHash: true },
  });

  for (const c of candidates) {
    if (!c.inboxTokenHash) continue;
    const ok = await bcrypt.compare(raw, c.inboxTokenHash);
    if (ok) {
      request.agentBot = { id: c.id, organizationId: c.organizationId, name: c.name };
      return;
    }
  }

  reply.status(401).send({
    error: "Unauthorized",
    message: "Invalid agent bot token",
    statusCode: 401,
  });
}

export async function hashBotInboxToken(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function generateBotInboxTokenParts(): { token: string; prefix: string } {
  const suffix = randomBytes(24).toString("hex");
  const token = `${TOKEN_PREFIX}${suffix}`;
  const prefix = token.slice(0, 12);
  return { token, prefix };
}
