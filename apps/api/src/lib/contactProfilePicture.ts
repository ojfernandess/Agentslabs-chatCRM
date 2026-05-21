import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** URLs que o browser não consegue carregar directamente (403 sem sessão WhatsApp/Facebook). */
export function isBrowserBlockedProfilePictureUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u.startsWith("http")) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("fbcdn.net") ||
      host.includes("facebook.com") ||
      host.includes("fbsbx.com") ||
      host.includes("whatsapp.net") ||
      host.endsWith(".cdninstagram.com")
    );
  } catch {
    return true;
  }
}

function cacheDir(organizationId: string): string {
  return join(config.mediaUploadDir, "contact-avatars", organizationId);
}

function cachePath(organizationId: string, contactId: string, sourceUrl: string): string {
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
  return join(cacheDir(organizationId), `${contactId}.${hash}.jpg`);
}

export async function readCachedContactProfilePicture(
  organizationId: string,
  contactId: string,
  sourceUrl: string,
): Promise<Buffer | null> {
  const path = cachePath(organizationId, contactId, sourceUrl);
  if (!existsSync(path)) return null;
  try {
    const st = await stat(path);
    if (Date.now() - st.mtimeMs > CACHE_TTL_MS) return null;
    const buf = await readFile(path);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export async function fetchAndCacheContactProfilePicture(
  organizationId: string,
  contactId: string,
  sourceUrl: string,
): Promise<Buffer | null> {
  const cached = await readCachedContactProfilePicture(organizationId, contactId, sourceUrl);
  if (cached) return cached;

  try {
    const res = await fetch(sourceUrl, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64 || buf.length > 5 * 1024 * 1024) return null;

    const dir = cacheDir(organizationId);
    await mkdir(dir, { recursive: true });
    await writeFile(cachePath(organizationId, contactId, sourceUrl), buf);
    return buf;
  } catch {
    return null;
  }
}
