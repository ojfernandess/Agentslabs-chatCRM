import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import type { JwtPayload } from "./auth.js";

const TOKEN_PREFIX = "ocu_";

function bearerRawToken(request: FastifyRequest): string | null {
  const h = request.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

function rawApiAccessTokenHeader(request: FastifyRequest): string | null {
  const v = request.headers["api_access_token"];
  return typeof v === "string" ? v.trim() : null;
}

export async function authenticateUserApiToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<JwtPayload | null> {
  const rawFromHeader = rawApiAccessTokenHeader(request);
  const bearer = bearerRawToken(request);
  /** Suporta também `Authorization: Bearer ocu_...` (ferramentas que só expõem Bearer). */
  const raw =
    rawFromHeader ?? (bearer?.startsWith(TOKEN_PREFIX) ? bearer : null);
  if (!raw?.startsWith(TOKEN_PREFIX) || raw.length < TOKEN_PREFIX.length + 16) return null;

  const prefix = raw.slice(0, 12);
  const candidates = await prisma.user.findMany({
    where: { apiAccessTokenPrefix: prefix },
    select: { id: true, email: true, role: true, organizationId: true, apiAccessTokenHash: true },
    take: 20,
  });

  for (const c of candidates) {
    if (!c.apiAccessTokenHash) continue;
    const ok = await bcrypt.compare(raw, c.apiAccessTokenHash);
    if (!ok) continue;
    await prisma.user.update({
      where: { id: c.id },
      data: { apiAccessTokenLastUsedAt: new Date() },
    });
    return {
      id: c.id,
      email: c.email,
      role: c.role,
      organizationId: c.organizationId,
    };
  }

  reply.status(401).send({ error: "Unauthorized", message: "Invalid API access token", statusCode: 401 });
  return null;
}

export function generateUserApiAccessTokenParts(): { token: string; prefix: string } {
  const suffix = randomBytes(24).toString("hex");
  const token = `${TOKEN_PREFIX}${suffix}`;
  const prefix = token.slice(0, 12);
  return { token, prefix };
}

export async function hashUserApiAccessToken(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
