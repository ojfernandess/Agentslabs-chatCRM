import type { FastifyBaseLogger } from "fastify";
import {
  buildConversationMediaInventory,
  deleteConversationMediaFiles,
} from "./conversationMediaAdmin.js";
import {
  getConversationMediaRetentionFromDb,
  saveConversationMediaRetentionValue,
} from "./conversationMediaRetentionSettings.js";

function cutoffDate(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

export async function runConversationMediaRetentionTick(options?: {
  log?: FastifyBaseLogger;
  force?: boolean;
}): Promise<{ deletedFiles: number; clearedReferences: number } | null> {
  const settings = await getConversationMediaRetentionFromDb();
  if (!settings.enabled) return null;

  const now = new Date();
  if (!options?.force && settings.lastRunAt) {
    const last = new Date(settings.lastRunAt);
    const hoursSince = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
    if (hoursSince < 23) return null;
  }

  const cutoff = cutoffDate(settings.retentionMonths);
  const items = await buildConversationMediaInventory();
  const filenames = items
    .filter((item) => {
      if (!item.lastUsedAt) return false;
      return new Date(item.lastUsedAt) < cutoff;
    })
    .map((item) => item.filename);

  let deletedFiles = 0;
  let clearedReferences = 0;

  for (let i = 0; i < filenames.length; i += 100) {
    const chunk = filenames.slice(i, i + 100);
    const result = await deleteConversationMediaFiles(chunk);
    deletedFiles += result.deleted.length;
    clearedReferences += result.clearedDbReferences;
    if (result.errors.length > 0) {
      options?.log?.warn({ errors: result.errors }, "conversation_media_retention_partial_errors");
    }
  }

  await saveConversationMediaRetentionValue({
    ...settings,
    lastRunAt: now.toISOString(),
    lastDeletedFiles: deletedFiles,
    lastClearedReferences: clearedReferences,
  });

  if (deletedFiles > 0 || clearedReferences > 0) {
    options?.log?.info(
      { deletedFiles, clearedReferences, retentionMonths: settings.retentionMonths },
      "conversation_media_retention_completed",
    );
  }

  return { deletedFiles, clearedReferences };
}
