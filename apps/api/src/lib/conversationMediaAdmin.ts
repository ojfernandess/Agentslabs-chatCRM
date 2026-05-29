import { existsSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getPublicOrigin } from "../config.js";
import {
  getResolvedMediaStorage,
  publicMessageMediaUrl,
  resolveFromEnvForAdmin,
} from "./mediaStorage.js";
import { extractMessageMediaFilename, MESSAGE_MEDIA_FILENAME_RE } from "./messageMediaFilename.js";

export type ConversationMediaStorageKind = "local" | "minio" | "both" | "db_only";

export type ConversationMediaInventoryItem = {
  filename: string;
  mediaUrl: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  storage: {
    local: boolean;
    minio: boolean;
  };
  storageKind: ConversationMediaStorageKind;
  referencedInDb: boolean;
  referenceCount: number;
  messageTypes: string[];
  organizations: { id: string; name: string }[];
  sources: ("conversation" | "team_channel")[];
  lastUsedAt: string | null;
};

type StoredFileMeta = {
  sizeBytes: number | null;
  lastModified: Date | null;
};

type DbReference = {
  filename: string;
  mediaUrl: string;
  contentType: string | null;
  messageType: string;
  organizationId: string;
  organizationName: string;
  source: "conversation" | "team_channel";
  createdAt: Date;
};

type MinioTarget = { client: S3Client; bucket: string; label: string };

function storageKind(local: boolean, minio: boolean, referencedInDb: boolean): ConversationMediaStorageKind {
  if (local && minio) return "both";
  if (local) return "local";
  if (minio) return "minio";
  if (referencedInDb) return "db_only";
  return "db_only";
}

async function collectMinioTargets(): Promise<MinioTarget[]> {
  const targets: MinioTarget[] = [];
  const seen = new Set<string>();

  const push = (client: S3Client, bucket: string, label: string) => {
    const key = `${label}:${bucket}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ client, bucket, label });
  };

  const resolved = await getResolvedMediaStorage();
  if (resolved.minio) push(resolved.minio.client, resolved.minio.bucket, "active");

  const envResolved = resolveFromEnvForAdmin();
  if (envResolved?.minio) push(envResolved.minio.client, envResolved.minio.bucket, "env");

  return targets;
}

async function listLocalFiles(): Promise<Map<string, StoredFileMeta>> {
  const out = new Map<string, StoredFileMeta>();
  const dir = config.mediaUploadDir;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!MESSAGE_MEDIA_FILENAME_RE.test(name)) continue;
    try {
      const st = await stat(join(dir, name));
      if (!st.isFile()) continue;
      out.set(name, { sizeBytes: st.size, lastModified: st.mtime });
    } catch {
      /* ignore unreadable file */
    }
  }
  return out;
}

async function listMinioFiles(targets: MinioTarget[]): Promise<Map<string, StoredFileMeta>> {
  const out = new Map<string, StoredFileMeta>();
  for (const target of targets) {
    let token: string | undefined;
    do {
      const res = await target.client.send(
        new ListObjectsV2Command({
          Bucket: target.bucket,
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        const key = obj.Key ?? "";
        if (!MESSAGE_MEDIA_FILENAME_RE.test(key)) continue;
        const prev = out.get(key);
        const nextModified = obj.LastModified ?? null;
        if (
          !prev ||
          (nextModified && prev.lastModified && nextModified > prev.lastModified) ||
          (obj.Size != null && prev.sizeBytes == null)
        ) {
          out.set(key, {
            sizeBytes: typeof obj.Size === "number" ? obj.Size : null,
            lastModified: nextModified,
          });
        }
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  return out;
}

async function loadDbReferences(): Promise<Map<string, DbReference[]>> {
  const map = new Map<string, DbReference[]>();

  const pushRef = (ref: DbReference) => {
    const list = map.get(ref.filename) ?? [];
    list.push(ref);
    map.set(ref.filename, list);
  };

  const [messages, teamMessages] = await Promise.all([
    prisma.message.findMany({
      where: { mediaUrl: { not: null } },
      select: {
        mediaUrl: true,
        mediaType: true,
        type: true,
        createdAt: true,
        conversation: {
          select: {
            organizationId: true,
            organization: { select: { name: true } },
          },
        },
      },
    }),
    prisma.teamChannelMessage.findMany({
      where: { attachmentUrl: { not: null } },
      select: {
        attachmentUrl: true,
        attachmentMimeType: true,
        createdAt: true,
        channel: {
          select: {
            team: {
              select: {
                organizationId: true,
                organization: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  for (const msg of messages) {
    const filename = extractMessageMediaFilename(msg.mediaUrl);
    if (!filename) continue;
    pushRef({
      filename,
      mediaUrl: msg.mediaUrl!,
      contentType: msg.mediaType,
      messageType: msg.type,
      organizationId: msg.conversation.organizationId,
      organizationName: msg.conversation.organization.name,
      source: "conversation",
      createdAt: msg.createdAt,
    });
  }

  for (const msg of teamMessages) {
    const filename = extractMessageMediaFilename(msg.attachmentUrl);
    if (!filename) continue;
    const team = msg.channel.team;
    pushRef({
      filename,
      mediaUrl: msg.attachmentUrl!,
      contentType: msg.attachmentMimeType,
      messageType: "ATTACHMENT",
      organizationId: team.organizationId,
      organizationName: team.organization.name,
      source: "team_channel",
      createdAt: msg.createdAt,
    });
  }

  return map;
}

function mergeOrganizations(refs: DbReference[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const ref of refs) {
    if (!seen.has(ref.organizationId)) seen.set(ref.organizationId, ref.organizationName);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

export async function buildConversationMediaInventory(): Promise<ConversationMediaInventoryItem[]> {
  const [localFiles, minioTargets, dbRefs] = await Promise.all([
    listLocalFiles(),
    collectMinioTargets(),
    loadDbReferences(),
  ]);
  const minioFiles = minioTargets.length > 0 ? await listMinioFiles(minioTargets) : new Map<string, StoredFileMeta>();

  const filenames = new Set<string>([
    ...localFiles.keys(),
    ...minioFiles.keys(),
    ...dbRefs.keys(),
  ]);

  const storage = await getResolvedMediaStorage();
  const items: ConversationMediaInventoryItem[] = [];

  for (const filename of filenames) {
    const refs = dbRefs.get(filename) ?? [];
    const local = localFiles.has(filename);
    const minio = minioFiles.has(filename);
    const localMeta = localFiles.get(filename);
    const minioMeta = minioFiles.get(filename);
    const referencedInDb = refs.length > 0;

    const lastUsedAt = refs.reduce<Date | null>((acc, ref) => {
      if (!acc || ref.createdAt > acc) return ref.createdAt;
      return acc;
    }, null);

    const fileDates = [localMeta?.lastModified ?? null, minioMeta?.lastModified ?? null].filter(Boolean) as Date[];
    const bestFileDate =
      fileDates.length > 0 ? fileDates.reduce((a, b) => (a > b ? a : b)) : null;
    const resolvedLastUsed = lastUsedAt ?? bestFileDate;

    const mediaUrl =
      refs[0]?.mediaUrl ??
      (local || minio ? publicMessageMediaUrl(filename, storage) : null);

    items.push({
      filename,
      mediaUrl,
      contentType: refs.find((r) => r.contentType)?.contentType ?? null,
      sizeBytes: localMeta?.sizeBytes ?? minioMeta?.sizeBytes ?? null,
      storage: { local, minio },
      storageKind: storageKind(local, minio, referencedInDb),
      referencedInDb,
      referenceCount: refs.length,
      messageTypes: [...new Set(refs.map((r) => r.messageType))],
      organizations: mergeOrganizations(refs),
      sources: [...new Set(refs.map((r) => r.source))],
      lastUsedAt: resolvedLastUsed ? resolvedLastUsed.toISOString() : null,
    });
  }

  items.sort((a, b) => {
    const ta = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const tb = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    return tb - ta;
  });

  return items;
}

export type ConversationMediaInventoryQuery = {
  page: number;
  limit: number;
  q?: string;
  storage?: ConversationMediaStorageKind | "all";
  organizationId?: string;
  type?: string;
};

export function filterConversationMediaInventory(
  items: ConversationMediaInventoryItem[],
  query: ConversationMediaInventoryQuery,
): ConversationMediaInventoryItem[] {
  let filtered = items;
  const q = query.q?.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (item) =>
        item.filename.toLowerCase().includes(q) ||
        item.mediaUrl?.toLowerCase().includes(q) ||
        item.organizations.some((o) => o.name.toLowerCase().includes(q)),
    );
  }
  if (query.storage && query.storage !== "all") {
    filtered = filtered.filter((item) => item.storageKind === query.storage);
  }
  if (query.organizationId) {
    filtered = filtered.filter((item) =>
      item.organizations.some((o) => o.id === query.organizationId),
    );
  }
  if (query.type) {
    filtered = filtered.filter((item) => item.messageTypes.includes(query.type!));
  }
  return filtered;
}

export function paginateConversationMediaInventory<T>(
  items: T[],
  page: number,
  limit: number,
): { data: T[]; total: number; page: number; limit: number; totalPages: number } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    total,
    page: safePage,
    limit,
    totalPages,
  };
}

export async function getConversationMediaInventoryStats(items: ConversationMediaInventoryItem[]) {
  let localCount = 0;
  let minioCount = 0;
  let bothCount = 0;
  let dbOnlyCount = 0;
  let totalBytes = 0;
  for (const item of items) {
    if (item.storage.local) localCount += 1;
    if (item.storage.minio) minioCount += 1;
    if (item.storageKind === "both") bothCount += 1;
    if (item.storageKind === "db_only") dbOnlyCount += 1;
    if (item.sizeBytes != null) totalBytes += item.sizeBytes;
  }
  return {
    totalFiles: items.length,
    referencedInDb: items.filter((i) => i.referencedInDb).length,
    localCount,
    minioCount,
    bothCount,
    dbOnlyCount,
    totalBytes,
    activeDriver: (await getResolvedMediaStorage()).driver,
    localDir: config.mediaUploadDir,
    publicOrigin: getPublicOrigin(),
  };
}

async function deleteLocalFile(filename: string): Promise<boolean> {
  const filePath = join(config.mediaUploadDir, filename);
  if (!existsSync(filePath)) return false;
  await unlink(filePath);
  return true;
}

async function deleteMinioFile(filename: string, targets: MinioTarget[]): Promise<boolean> {
  let deleted = false;
  for (const target of targets) {
    try {
      await target.client.send(
        new HeadObjectCommand({ Bucket: target.bucket, Key: filename }),
      );
    } catch {
      continue;
    }
    await target.client.send(
      new DeleteObjectCommand({ Bucket: target.bucket, Key: filename }),
    );
    deleted = true;
  }
  return deleted;
}

export async function deleteConversationMediaFiles(filenames: string[]): Promise<{
  deleted: string[];
  clearedDbReferences: number;
  errors: { filename: string; message: string }[];
}> {
  const valid = filenames.filter((f) => MESSAGE_MEDIA_FILENAME_RE.test(f));
  const invalid = filenames.filter((f) => !MESSAGE_MEDIA_FILENAME_RE.test(f));
  const errors = invalid.map((filename) => ({ filename, message: "Invalid filename" }));
  if (valid.length === 0) {
    return { deleted: [], clearedDbReferences: 0, errors };
  }

  const targets = await collectMinioTargets();
  const deleted: string[] = [];

  for (const filename of valid) {
    try {
      const localDeleted = await deleteLocalFile(filename);
      const minioDeleted = targets.length > 0 ? await deleteMinioFile(filename, targets) : false;
      if (localDeleted || minioDeleted) deleted.push(filename);
    } catch (err) {
      errors.push({
        filename,
        message: err instanceof Error ? err.message : "Delete failed",
      });
    }
  }

  const clearedDbReferences = await clearDbMediaReferences(valid);

  return { deleted, clearedDbReferences, errors };
}

async function clearDbMediaReferences(filenames: string[]): Promise<number> {
  if (filenames.length === 0) return 0;
  const set = new Set(filenames);
  let cleared = 0;

  const [messages, teamMessages] = await Promise.all([
    prisma.message.findMany({
      where: { mediaUrl: { not: null } },
      select: { id: true, mediaUrl: true },
    }),
    prisma.teamChannelMessage.findMany({
      where: { attachmentUrl: { not: null } },
      select: { id: true, attachmentUrl: true },
    }),
  ]);

  const messageIds = messages
    .filter((m) => {
      const fn = extractMessageMediaFilename(m.mediaUrl);
      return fn != null && set.has(fn);
    })
    .map((m) => m.id);

  const teamMessageIds = teamMessages
    .filter((m) => {
      const fn = extractMessageMediaFilename(m.attachmentUrl);
      return fn != null && set.has(fn);
    })
    .map((m) => m.id);

  if (messageIds.length > 0) {
    const res = await prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: { mediaUrl: null, mediaType: null },
    });
    cleared += res.count;
  }

  if (teamMessageIds.length > 0) {
    const res = await prisma.teamChannelMessage.updateMany({
      where: { id: { in: teamMessageIds } },
      data: { attachmentUrl: null, attachmentMimeType: null, attachmentName: null },
    });
    cleared += res.count;
  }

  return cleared;
}
