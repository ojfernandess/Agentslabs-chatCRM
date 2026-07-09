import type { Prisma, PrismaClient } from "@prisma/client";

const EMAIL_PHONE_PREFIX = "oc|EMAIL|";

export async function loadEmailStateByConversation(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  conversationIds: string[],
): Promise<Map<string, { isStarred: boolean; emailFolderId: string | null }>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await db.conversationUserEmailState.findMany({
    where: { userId, conversationId: { in: conversationIds } },
    select: { conversationId: true, isStarred: true, emailFolderId: true },
  });
  return new Map(
    rows.map((row) => [
      row.conversationId,
      { isStarred: row.isStarred, emailFolderId: row.emailFolderId },
    ]),
  );
}

export function applyEmailWorkspaceConversationFilters(
  where: Prisma.ConversationWhereInput,
  opts: {
    userId: string;
    trashOnly: boolean;
    starredOnly: boolean;
    emailFolderId?: string;
    inboxScoped: boolean;
  },
): void {
  if (opts.trashOnly) return;

  if (opts.starredOnly) {
    where.userEmailStates = { some: { userId: opts.userId, isStarred: true } };
    return;
  }

  if (opts.emailFolderId) {
    where.userEmailStates = {
      some: { userId: opts.userId, emailFolderId: opts.emailFolderId },
    };
    return;
  }

  if (opts.inboxScoped) {
    const existingNot = where.NOT
      ? Array.isArray(where.NOT)
        ? where.NOT
        : [where.NOT]
      : [];
    where.NOT = [
      ...existingNot,
      {
        userEmailStates: {
          some: { userId: opts.userId, emailFolderId: { not: null } },
        },
      },
    ];
  }
}

export async function upsertConversationEmailStar(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  starred: boolean,
): Promise<void> {
  await db.conversationUserEmailState.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    create: { userId, conversationId, isStarred: starred },
    update: { isStarred: starred },
  });
}

export async function upsertConversationEmailFolder(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  emailFolderId: string | null,
): Promise<void> {
  if (emailFolderId === null) {
    const existing = await db.conversationUserEmailState.findUnique({
      where: { userId_conversationId: { userId, conversationId } },
      select: { isStarred: true },
    });
    if (!existing) return;
    if (existing.isStarred) {
      await db.conversationUserEmailState.update({
        where: { userId_conversationId: { userId, conversationId } },
        data: { emailFolderId: null },
      });
      return;
    }
    await db.conversationUserEmailState.delete({
      where: { userId_conversationId: { userId, conversationId } },
    });
    return;
  }

  await db.conversationUserEmailState.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    create: { userId, conversationId, emailFolderId },
    update: { emailFolderId },
  });
}

export function contactHasEmailFilter(): Prisma.ContactWhereInput {
  return {
    OR: [
      { email: { contains: "@", mode: "insensitive" } },
      { phone: { startsWith: EMAIL_PHONE_PREFIX } },
    ],
  };
}
