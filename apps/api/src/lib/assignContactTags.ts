import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "conversation" | "tag" | "contactTag" | "$transaction">;

export async function assignTagsToConversationContact(
  db: Db,
  input: {
    organizationId: string;
    conversationId: string;
    tagIds: string[];
    mode?: "add" | "replace";
  },
): Promise<
  | { ok: true; contactId: string; tags: Array<{ id: string; name: string; color: string }> }
  | { ok: false; error: string }
> {
  const mode = input.mode ?? "add";
  const tagIds = [...new Set(input.tagIds.map((id) => id.trim()).filter(Boolean))];
  if (!tagIds.length) {
    return { ok: false, error: "missing_tag_ids" };
  }

  const conversation = await db.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, contactId: true },
  });
  if (!conversation) {
    return { ok: false, error: "conversation_not_found" };
  }

  const existingTags = await db.tag.findMany({
    where: { organizationId: input.organizationId, id: { in: tagIds } },
    select: { id: true },
  });
  if (existingTags.length !== tagIds.length) {
    return { ok: false, error: "invalid_tag_ids" };
  }

  await db.$transaction(async (tx) => {
    if (mode === "replace") {
      await tx.contactTag.deleteMany({ where: { contactId: conversation.contactId } });
    }
    await tx.contactTag.createMany({
      data: tagIds.map((tagId) => ({ contactId: conversation.contactId, tagId })),
      skipDuplicates: true,
    });
  });

  const contactTags = await db.contactTag.findMany({
    where: { contactId: conversation.contactId },
    orderBy: { tagId: "asc" },
  });
  const tags = await db.tag.findMany({
    where: { id: { in: contactTags.map((ct) => ct.tagId) }, organizationId: input.organizationId },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });

  return { ok: true, contactId: conversation.contactId, tags };
}
