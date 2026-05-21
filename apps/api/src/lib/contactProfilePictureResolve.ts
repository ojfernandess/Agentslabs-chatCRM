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

async function readContactAvatarCache(
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

async function writeContactAvatarCache(
  organizationId: string,
  contactId: string,
  buf: Buffer,
): Promise<void> {
  const dir = cacheDir(organizationId);
  await mkdir(dir, { recursive: true });
  await writeFile(contactAvatarCachePath(organizationId, contactId), buf);
}

async function getWhatsAppProviderForContact(
  organizationId: string,
  contactId: string,
): Promise<WhatsAppProviderInterface | null> {
  const conv = await prisma.conversation.findFirst({
    where: {
      organizationId,
      contactId,
      inbox: { channelType: "WHATSAPP" },
    },
    orderBy: { updatedAt: "desc" },
    select: { inboxId: true },
  });
  if (conv?.inboxId) {
    const p = await getWhatsAppProviderForInbox(organizationId, conv.inboxId);
    if (p) return p;
  }

  const inbox = await prisma.inbox.findFirst({
    where: { organizationId, channelType: "WHATSAPP" },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  if (inbox) {
    const p = await getWhatsAppProviderForInbox(organizationId, inbox.id);
    if (p) return p;
  }

  return getWhatsAppProvider(organizationId);
}

/**
 * Resolve avatar bytes: cache local → URL CDN → refresh via Evolution / Evolution Go.
 */
export async function resolveContactProfilePictureBuffer(params: {
  organizationId: string;
  contactId: string;
  phone: string;
  profilePictureUrl: string | null;
}): Promise<Buffer | null> {
  const { organizationId, contactId, phone } = params;
  let profilePictureUrl = params.profilePictureUrl?.trim() || null;

  const cached = await readContactAvatarCache(organizationId, contactId);
  if (cached) return cached;

  if (profilePictureUrl) {
    const fromUrl = await fetchAndCacheContactProfilePicture(
      organizationId,
      contactId,
      profilePictureUrl,
    );
    if (fromUrl) {
      await writeContactAvatarCache(organizationId, contactId, fromUrl);
      return fromUrl;
    }
  }

  const provider = await getWhatsAppProviderForContact(organizationId, contactId);
  if (!provider) return null;

  if (provider.fetchContactProfilePictureBuffer) {
    const buf = await provider.fetchContactProfilePictureBuffer(phone).catch(() => null);
    if (buf) {
      await writeContactAvatarCache(organizationId, contactId, buf);
      return buf;
    }
  }

  if (provider.fetchContactProfilePictureUrl) {
    const fresh = await provider.fetchContactProfilePictureUrl(phone).catch(() => undefined);
    if (fresh?.trim()) {
      profilePictureUrl = fresh.trim();
      await prisma.contact
        .update({
          where: { id: contactId },
          data: { profilePictureUrl: fresh.trim() },
        })
        .catch(() => {});

      const fromFresh = await fetchAndCacheContactProfilePicture(
        organizationId,
        contactId,
        profilePictureUrl,
      );
      if (fromFresh) {
        await writeContactAvatarCache(organizationId, contactId, fromFresh);
        return fromFresh;
      }
    }
  }

  return null;
}
