import type { FastifyReply, FastifyRequest } from "fastify";
import {
  getCachedApiEndpointRateLimitConfig,
  type ApiEndpointRateLimitKey,
  type ApiEndpointRateLimitKeyBy,
  type ApiEndpointRateLimitRule,
} from "./apiEndpointRateLimitSettings.js";

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    if (rateBuckets.size > 50_000) {
      for (const [k, b] of rateBuckets) {
        if (b.resetAt <= now) rateBuckets.delete(k);
      }
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

function resolveRateLimitKey(request: FastifyRequest, endpointKey: ApiEndpointRateLimitKey, keyBy: ApiEndpointRateLimitKeyBy): string {
  switch (keyBy) {
    case "api_token": {
      const auth = request.headers.authorization;
      if (typeof auth === "string" && auth.startsWith("Bearer ") && auth.length > 16) {
        return `${endpointKey}:token:${auth.slice(7, 40)}`;
      }
      const headerToken = request.headers["api_access_token"];
      if (typeof headerToken === "string" && headerToken.length > 8) {
        return `${endpointKey}:token:${headerToken.slice(0, 40)}`;
      }
      return `${endpointKey}:ip:${request.ip}`;
    }
    case "user": {
      const userId = request.user?.id;
      return userId ? `${endpointKey}:user:${userId}` : `${endpointKey}:ip:${request.ip}`;
    }
    case "ip":
      return `${endpointKey}:ip:${request.ip}`;
    case "organization":
    default: {
      const user = request.user;
      const org = user?.actingOrganizationId?.trim() || user?.organizationId?.trim();
      if (org) return `${endpointKey}:org:${org}`;
      if (user?.id) return `${endpointKey}:user:${user.id}`;
      return `${endpointKey}:ip:${request.ip}`;
    }
  }
}

export function enforceApiEndpointRateLimit(endpointKey: ApiEndpointRateLimitKey) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const config = await getCachedApiEndpointRateLimitConfig();
    const rule: ApiEndpointRateLimitRule | undefined = config.endpoints[endpointKey];
    if (!rule?.enabled) return;

    const key = resolveRateLimitKey(request, endpointKey, rule.keyBy);
    const windowMs = rule.timeWindowSeconds * 1000;
    if (isRateLimited(key, rule.max, windowMs)) {
      return reply
        .header("Retry-After", String(rule.timeWindowSeconds))
        .status(429)
        .send({
          error: "Too Many Requests",
          message: `Rate limit exceeded (${rule.max} requests per ${rule.timeWindowSeconds} second(s))`,
          statusCode: 429,
        });
    }
  };
}
