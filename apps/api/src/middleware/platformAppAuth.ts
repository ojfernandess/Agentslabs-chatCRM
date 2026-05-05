import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcrypt";
import { prisma } from "../db.js";

declare module "fastify" {
  interface FastifyRequest {
    platformApplication?: { id: string; name: string };
  }
}

export async function authenticatePlatformApplication(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  const raw = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw.startsWith("ocp_") || raw.length < 16) {
    reply.status(401).send({
      error: "Unauthorized",
      message: "Invalid or missing platform token",
      statusCode: 401,
    });
    return;
  }

  const prefix = raw.slice(0, 12);
  const candidates = await prisma.platformApplication.findMany({
    where: { tokenPrefix: prefix },
    select: { id: true, name: true, tokenHash: true },
  });

  for (const c of candidates) {
    const ok = await bcrypt.compare(raw, c.tokenHash);
    if (ok) {
      await prisma.platformApplication.update({
        where: { id: c.id },
        data: { lastUsedAt: new Date() },
      });
      request.platformApplication = { id: c.id, name: c.name };
      return;
    }
  }

  reply.status(401).send({
    error: "Unauthorized",
    message: "Invalid platform token",
    statusCode: 401,
  });
}
