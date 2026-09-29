import IORedis from "ioredis";

const DEDUPE_TTL_SECONDS = 86_400;

let connection: IORedis | null = null;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url || null;
}

function getConnection(): IORedis | null {
  const url = getRedisUrl();
  if (!url) return null;
  if (!connection) {
    connection = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });
    connection.on("error", () => {
      // degrade: dedupe optional
    });
  }
  return connection;
}

function dedupeKey(organizationId: string, waMessageId: string): string {
  return `meta:inbound:dedupe:${organizationId}:${waMessageId}`;
}

/** Retorna true se este wamid ainda não foi visto (claim OK). */
export async function claimMetaInboundWaMessageId(
  organizationId: string,
  waMessageId: string,
): Promise<boolean> {
  const id = waMessageId.trim();
  if (!id) return true;
  const redis = getConnection();
  if (!redis) return true;
  try {
    if (redis.status !== "ready") await redis.connect();
    const result = await redis.set(dedupeKey(organizationId, id), "1", "EX", DEDUPE_TTL_SECONDS, "NX");
    return result === "OK";
  } catch {
    return true;
  }
}

export function buildMetaInboundJobId(
  organizationId: string,
  inboxId: string,
  waMessageIds: string[],
): string {
  const ids = [...waMessageIds].map((id) => id.trim()).filter(Boolean).sort();
  const suffix = ids.length > 0 ? ids.join(",") : "contacts";
  const raw = `meta-inbound:${organizationId}:${inboxId}:${suffix}`;
  return raw.length > 220 ? raw.slice(0, 220) : raw;
}
