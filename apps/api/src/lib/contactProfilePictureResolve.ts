import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { fetchAndCacheContactProfilePicture } from "./contactProfilePicture.js";
import {
  getWhatsAppProvider,
  getWhatsAppProviderForInbox,
} from "../providers/factory.js";
import type { WhatsAppProviderInterface } from "../providers/types.js";

const AVATAR_FILE = "avatar.jpg";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function cacheDir(organizationId: string): string {
  return join(config.mediaUploadDir, "contact-avatars", organizationId);
}

function contactAvatarCachePath(organizationId: string, contactId: string): string {
  return join(cacheDir(organizationId), `${contactId}.${AVATAR_FILE}`);
}

export async function readContactAvatarCache(
  organizationId: string,
  contactId: string,
): Promise<Buffer | null> {
  const path = contactAvatarCachePath(organizationId, contactId);
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

export async function writeContactAvatarCache(
  organizationId: string,
  contactId: string,
  buf: Buffer,
): Promise<void> {
  const dir = cacheDir(organizationId);
  await mkdir(dir, { recursive: true });
  await writeFile(contactAvatarCachePath(organizationId, contactId), buf);
}

export async function hasContactAvatarCache(
  organizationId: string,
  contactId: string,
): Promise<boolean> {
  return (await readContactAvatarCache(organizationId, contactId)) != null;
}

async function listWhatsAppAvatarProviders(
  organizationId: string,
  preferredInboxId?: string | null,
): Promise<WhatsAppProviderInterface[]> {
  const out: WhatsAppProviderInterface[] = [];
  const seen = new WeakSet<object>();

  const push = (p: WhatsAppProviderInterface | null) => {
    if (!p) return;
    if (seen.has(p)) return;
    if (!p.fetchContactProfilePictureBuffer && !p.fetchContactProfilePictureUrl) return;
    seen.add(p);
    out.push(p);
  };

  if (preferredInboxId) {
    push(await getWhatsAppProviderForInbox(organizationId, preferredInboxId));
  }

  const inboxes = await prisma.inbox.findMany({
    where: { organizationId, channelType: "WHATSAPP" },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });

  for (const inbox of inboxes) {
    if (inbox.id === preferredInboxId) continue;
    push(await getWhatsAppProviderForInbox(organizationId, inbox.id));
  }

  push(await getWhatsAppProvider(organizationId));
  return out;
}

async function fetchViaProvider(
  provider: WhatsAppProviderInterface,
  phone: string,
  organizationId: string,
  contactId: string,
): Promise<Buffer | null> {
  if (provider.fetchContactProfilePictureBuffer) {
    const buf = await provider.fetchContactProfilePictureBuffer(phone).catch(() => null);
    if (buf) return buf;
  }

  if (provider.fetchContactProfilePictureUrl) {
    const fresh = await provider.fetchContactProfilePictureUrl(phone).catch(() => undefined);
    if (fresh?.trim()) {
      await prisma.contact
        .update({
          where: { id: contactId },
          data: { profilePictureUrl: fresh.trim() },
        })
        .catch(() => {});
      const fromUrl = await fetchAndCacheContactProfilePicture(
        organizationId,
        contactId,
        fresh.trim(),
      );
      if (fromUrl) return fromUrl;
    }
  }

  return null;
}

/**
 * Obtém foto via Evolution / Evolution Go (e URL fresca). Meta Cloud não tem avatar de contacto.
 */
export async function syncContactProfilePicture(params: {
  organizationId: string;
  contactId: string;
  phone: string;
  profilePictureUrl?: string | null;
  preferredInboxId?: string | null;
  force?: boolean;
}): Promise<Buffer | null> {
  const { organizationId, contactId, phone, force } = params;

  if (!force) {
    const cached = await readContactAvatarCache(organizationId, contactId);
    if (cached) return cached;
  }

  const providers = await listWhatsAppAvatarProviders(organizationId, params.preferredInboxId);
  for (const provider of providers) {
    const buf = await fetchViaProvider(provider, phone, organizationId, contactId);
    if (buf) {
      await writeContactAvatarCache(organizationId, contactId, buf);
      return buf;
    }
  }

  const storedUrl = params.profilePictureUrl?.trim();
  if (storedUrl) {
    const fromUrl = await fetchAndCacheContactProfilePicture(organizationId, contactId, storedUrl);
    if (fromUrl) {
      await writeContactAvatarCache(organizationId, contactId, fromUrl);
      return fromUrl;
    }
  }

  return null;
}

async function getPreferredInboxForContact(
  organizationId: string,
  contactId: string,
): Promise<string | null> {
  const conv = await prisma.conversation.findFirst({
    where: { organizationId, contactId, inbox: { channelType: "WHATSAPP" } },
    orderBy: { updatedAt: "desc" },
    select: { inboxId: true },
  });
  return conv?.inboxId ?? null;
}

export async function resolveContactProfilePictureBuffer(params: {
  organizationId: string;
  contactId: string;
  phone: string;
  profilePictureUrl: string | null;
}): Promise<Buffer | null> {
  const cached = await readContactAvatarCache(params.organizationId, params.contactId);
  if (cached) return cached;

  const preferredInboxId = await getPreferredInboxForContact(
    params.organizationId,
    params.contactId,
  );

  return syncContactProfilePicture({
    organizationId: params.organizationId,
    contactId: params.contactId,
    phone: params.phone,
    profilePictureUrl: params.profilePictureUrl,
    preferredInboxId,
  });
}

/** Sincroniza avatares em lote (máx. 40) para a lista de conversas/contatos. */
export async function syncContactProfilePicturesBatch(params: {
  organizationId: string;
  contactIds: string[];
}): Promise<{ synced: string[]; failed: string[] }> {
  const ids = [...new Set(params.contactIds)].slice(0, 40);
  const synced: string[] = [];
  const failed: string[] = [];

  if (ids.length === 0) return { synced, failed };

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId: params.organizationId,
      id: { in: ids },
      isGroupChat: false,
    },
    select: { id: true, phone: true, profilePictureUrl: true },
  });

  for (const c of contacts) {
    const hasCache = await hasContactAvatarCache(params.organizationId, c.id);
    if (hasCache) {
      synced.push(c.id);
      continue;
    }
    const preferredInboxId = await getPreferredInboxForContact(params.organizationId, c.id);
    const buf = await syncContactProfilePicture({
      organizationId: params.organizationId,
      contactId: c.id,
      phone: c.phone,
      profilePictureUrl: c.profilePictureUrl,
      preferredInboxId,
    });
    if (buf) synced.push(c.id);
    else failed.push(c.id);
  }

  return { synced, failed };
}
