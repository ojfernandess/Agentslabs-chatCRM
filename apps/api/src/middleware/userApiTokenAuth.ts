import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { z } from "zod";
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

function headerValueAsString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return null;
}

function normalizeToUuid(raw: string): string | null {
  const id = raw.trim().replace(/^["']|["']$/g, "").trim();
  return z.string().uuid().safeParse(id).success ? id : null;
}

/** SUPER_ADMIN com token ocu_ não tem JWT com actingOrganizationId; integrações podem enviar o UUID do tenant. */
function actingOrganizationIdFromRequest(request: FastifyRequest): string | null {
  const explicitHeaderKeys = [
    "openconduit-organization-id",
    "x-openconduit-organization-id",
    "organization-id",
    "x-organization-id",
    "organization_id",
    "organizationid",
    "x-organization",
    "org-id",
    "org_id",
    "x-org-id",
    "tenant-id",
    "x-tenant-id",
    "tenant_id",
  ];
  for (const key of explicitHeaderKeys) {
    const raw = headerValueAsString(request.headers[key]);
    if (!raw) continue;
    const id = normalizeToUuid(raw);
    if (id) return id;
  }

  for (const [key, val] of Object.entries(request.headers)) {
    if (!/(organization|org[-_]id|tenant[-_]id)/i.test(key)) continue;
    const raw = headerValueAsString(val);
    if (!raw) continue;
    const id = normalizeToUuid(raw);
    if (id) return id;
  }

  const q = request.query as Record<string, unknown> | undefined;
  if (q) {
    const queryKeys = [
      "organizationId",
      "organization_id",
      "orgId",
      "org_id",
      "tenantId",
      "tenant_id",
      "openconduitOrganizationId",
    ];
    for (const k of queryKeys) {
      const qv = q[k];
      if (typeof qv !== "string") continue;
      const id = normalizeToUuid(qv);
      if (id) return id;
    }
  }
  return null;
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

    const orgHeader = actingOrganizationIdFromRequest(request);

    if (c.role === "SUPER_ADMIN") {
      return {
        id: c.id,
        email: c.email,
        role: c.role,
        organizationId: c.organizationId,
        ...(orgHeader ? { actingOrganizationId: orgHeader } : {}),
      };
    }

    if (orgHeader && orgHeader !== c.organizationId) {
      reply.status(403).send({
        error: "Forbidden",
        message:
          "openconduit-organization-id header does not match this user's organization",
        statusCode: 403,
      });
      return null;
    }

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
