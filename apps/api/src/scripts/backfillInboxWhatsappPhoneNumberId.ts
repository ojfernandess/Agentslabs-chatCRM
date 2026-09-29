/**
 * Backfill `Inbox.whatsappPhoneNumberId` from `channelConfig` JSON.
 *
 * Usage (from apps/api, with DATABASE_URL reachable):
 *   npx tsx src/scripts/backfillInboxWhatsappPhoneNumberId.ts
 *
 * Safe to re-run — only updates rows where the column is null or out of sync.
 */
import { InboxChannelType, PrismaClient } from "@prisma/client";
import { inboxWhatsappPhoneNumberIdForColumn } from "../lib/inboxWhatsappConfig.js";

async function main() {
  const prisma = new PrismaClient();
  let scanned = 0;
  let updated = 0;

  try {
    const rows = await prisma.inbox.findMany({
      where: { channelType: InboxChannelType.WHATSAPP },
      select: { id: true, channelConfig: true, whatsappPhoneNumberId: true },
    });

    for (const row of rows) {
      scanned += 1;
      const expected = inboxWhatsappPhoneNumberIdForColumn(row.channelConfig);
      if (row.whatsappPhoneNumberId === expected) continue;
      await prisma.inbox.update({
        where: { id: row.id },
        data: { whatsappPhoneNumberId: expected },
      });
      updated += 1;
    }

    console.log(
      JSON.stringify({ ok: true, scanned, updated, unchanged: scanned - updated }, null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
