import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { recordAuditLog } from "../audit.js";
import {
  ANNOUNCEMENT_ICON_WHITELIST,
  ANNOUNCEMENT_TONE_WHITELIST,
  MAX_FEATURED_ANNOUNCEMENTS,
  MAX_PINNED_ANNOUNCEMENTS,
  isSafeAnnouncementLink,
  isSafeCoverUrl,
  sanitizeAnnouncementContent,
  slugifyTitle,
  type AnnouncementAudienceTarget,
} from "./announcementPolicy.js";

export class AnnouncementError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export type AudienceInput = {
  type: "ALL" | "ORGANIZATIONS" | "PLANS";
  organizationIds?: string[];
  planIds?: string[];
};

export type AnnouncementWriteInput = {
  title: string;
  summary: string;
  content: string;
  categoryId: string;
  coverUrl?: string | null;
  priority: "NORMAL" | "IMPORTANT" | "CRITICAL";
  isFeatured: boolean;
  isPinned: boolean;
  notifyUsers: boolean;
  requiresAcknowledgement: boolean;
  scheduledAt?: string | null;
  expiresAt?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  audience: AudienceInput;
  action: "draft" | "publish" | "schedule";
};

const listInclude = {
  category: true,
  targets: true,
} satisfies Prisma.AnnouncementInclude;

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value == null || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AnnouncementError(`${field} inválido`);
  }
  return date;
}

function normalizeAudience(audience: AudienceInput): AnnouncementAudienceTarget[] {
  if (audience.type === "ALL") return [{ targetType: "ALL", targetId: "" }];
  if (audience.type === "ORGANIZATIONS") {
    const ids = [...new Set((audience.organizationIds ?? []).map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > 200) {
      throw new AnnouncementError("Selecione entre 1 e 200 organizações");
    }
    return ids.map((targetId) => ({ targetType: "ORGANIZATION" as const, targetId }));
  }
  const ids = [...new Set((audience.planIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 50) {
    throw new AnnouncementError("Selecione entre 1 e 50 planos");
  }
  return ids.map((targetId) => ({ targetType: "PLAN" as const, targetId }));
}

async function assertTargetsExist(targets: AnnouncementAudienceTarget[]): Promise<void> {
  const orgIds = targets.filter((t) => t.targetType === "ORGANIZATION").map((t) => t.targetId);
  const planIds = targets.filter((t) => t.targetType === "PLAN").map((t) => t.targetId);
  if (orgIds.length > 0) {
    const found = await prisma.organization.count({ where: { id: { in: orgIds }, isActive: true } });
    if (found !== orgIds.length) throw new AnnouncementError("Uma ou mais organizações são inválidas");
  }
  if (planIds.length > 0) {
    const found = await prisma.plan.count({ where: { id: { in: planIds }, isActive: true } });
    if (found !== planIds.length) throw new AnnouncementError("Um ou mais planos são inválidos");
  }
}

function orgWhereForTargets(targets: AnnouncementAudienceTarget[]): Prisma.OrganizationWhereInput {
  if (targets.some((t) => t.targetType === "ALL")) return { isActive: true };
  const orgIds = targets.filter((t) => t.targetType === "ORGANIZATION").map((t) => t.targetId);
  const planIds = targets.filter((t) => t.targetType === "PLAN").map((t) => t.targetId);
  const or: Prisma.OrganizationWhereInput[] = [];
  if (orgIds.length > 0) or.push({ id: { in: orgIds } });
  if (planIds.length > 0) or.push({ subscription: { is: { planId: { in: planIds } } } });
  return { isActive: true, OR: or.length > 0 ? or : [{ id: { in: [] } }] };
}

function userWhereForOrgs(orgFilter: Prisma.OrganizationWhereInput): Prisma.UserWhereInput {
  return {
    role: { not: "SUPER_ADMIN" },
    OR: [
      { organization: orgFilter },
      { memberships: { some: { organization: orgFilter } } },
    ],
  };
}

export async function countAudience(targets: AnnouncementAudienceTarget[]): Promise<{
  organizations: number;
  users: number;
}> {
  const orgFilter = orgWhereForTargets(targets);
  const [organizations, users] = await Promise.all([
    prisma.organization.count({ where: orgFilter }),
    prisma.user.count({ where: userWhereForOrgs(orgFilter) }),
  ]);
  return { organizations, users };
}

export async function listAudienceOrganizationIds(targets: AnnouncementAudienceTarget[]): Promise<string[]> {
  const rows = await prisma.organization.findMany({
    where: orgWhereForTargets(targets),
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function planIdForOrganization(organizationId: string): Promise<string | null> {
  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: { planId: true },
  });
  return sub?.planId ?? null;
}

function visibleWhere(input: {
  organizationId: string;
  planId: string | null;
  now: Date;
  userId?: string;
  unreadOnly?: boolean;
  q?: string;
  categorySlug?: string;
}): Prisma.AnnouncementWhereInput {
  const audience: Prisma.AnnouncementWhereInput[] = [
    { targets: { some: { targetType: "ALL" } } },
    { targets: { some: { targetType: "ORGANIZATION", targetId: input.organizationId } } },
  ];
  if (input.planId) {
    audience.push({ targets: { some: { targetType: "PLAN", targetId: input.planId } } });
  }
  const and: Prisma.AnnouncementWhereInput[] = [{ OR: audience }];
  const q = input.q?.trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
        { category: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (input.categorySlug) and.push({ category: { slug: input.categorySlug } });
  if (input.unreadOnly && input.userId) {
    and.push({ reads: { none: { userId: input.userId } } });
  }
  return {
    deletedAt: null,
    status: "PUBLISHED",
    publishedAt: { lte: input.now },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }] },
      ...and,
    ],
  };
}

async function uniqueSlug(title: string, ignoreId?: string): Promise<string> {
  const base = slugifyTitle(title);
  for (let i = 0; i < 8; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const existing = await prisma.announcement.findFirst({
      where: { slug, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
      select: { id: true },
    });
    if (!existing) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function assertHighlightLimits(input: {
  isFeatured: boolean;
  isPinned: boolean;
  ignoreId?: string;
  applying: boolean;
}): Promise<void> {
  if (!input.applying) return;
  if (input.isFeatured) {
    const featured = await prisma.announcement.count({
      where: {
        deletedAt: null,
        isFeatured: true,
        status: { in: ["PUBLISHED", "SCHEDULED"] },
        ...(input.ignoreId ? { NOT: { id: input.ignoreId } } : {}),
      },
    });
    if (featured >= MAX_FEATURED_ANNOUNCEMENTS) {
      throw new AnnouncementError(`No máximo ${MAX_FEATURED_ANNOUNCEMENTS} destaques simultâneos`);
    }
  }
  if (input.isPinned) {
    const pinned = await prisma.announcement.count({
      where: {
        deletedAt: null,
        isPinned: true,
        status: { in: ["PUBLISHED", "SCHEDULED"] },
        ...(input.ignoreId ? { NOT: { id: input.ignoreId } } : {}),
      },
    });
    if (pinned >= MAX_PINNED_ANNOUNCEMENTS) {
      throw new AnnouncementError(`No máximo ${MAX_PINNED_ANNOUNCEMENTS} publicações fixadas`);
    }
  }
}

function validateWrite(input: AnnouncementWriteInput): {
  content: string;
  coverUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  scheduledAt: Date | null;
  expiresAt: Date | null;
  targets: AnnouncementAudienceTarget[];
} {
  const content = sanitizeAnnouncementContent(input.content);
  if (content.length < 1 || content.length > 20000) {
    throw new AnnouncementError("Conteúdo inválido");
  }
  const coverUrl = input.coverUrl?.trim() ? input.coverUrl.trim() : null;
  if (coverUrl && !isSafeCoverUrl(coverUrl)) throw new AnnouncementError("URL de capa inválida");
  const ctaLabel = input.ctaLabel?.trim() ? input.ctaLabel.trim() : null;
  const ctaUrl = input.ctaUrl?.trim() ? input.ctaUrl.trim() : null;
  if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) {
    throw new AnnouncementError("CTA precisa de texto e destino");
  }
  if (ctaUrl && !isSafeAnnouncementLink(ctaUrl)) throw new AnnouncementError("URL do CTA inválida");
  if (input.requiresAcknowledgement && input.priority === "NORMAL") {
    throw new AnnouncementError("Confirmação de leitura só é permitida em prioridade Importante ou Crítica");
  }
  const scheduledAt = parseDate(input.scheduledAt, "Agendamento");
  const expiresAt = parseDate(input.expiresAt, "Validade");
  if (input.action === "schedule") {
    if (!scheduledAt || scheduledAt.getTime() <= Date.now() + 30_000) {
      throw new AnnouncementError("Agende uma data futura");
    }
  }
  if (expiresAt && scheduledAt && expiresAt <= scheduledAt) {
    throw new AnnouncementError("A validade precisa ser posterior ao agendamento");
  }
  return { content, coverUrl, ctaLabel, ctaUrl, scheduledAt, expiresAt, targets: normalizeAudience(input.audience) };
}

async function audit(
  actorUserId: string,
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await recordAuditLog({
      actorUserId,
      action,
      resourceType: "announcement",
      resourceId,
      metadata,
    });
  } catch {
    /* auditoria não bloqueia o mural */
  }
}

const categorySelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  icon: true,
  tone: true,
  sortOrder: true,
} satisfies Prisma.AnnouncementCategorySelect;

export async function listCategories(activeOnly = true) {
  return prisma.announcementCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: { sortOrder: "asc" },
    select: categorySelect,
  });
}

export async function saveCategory(input: {
  id?: string;
  name: string;
  description?: string | null;
  icon: string;
  tone: string;
  sortOrder?: number;
  isActive?: boolean;
  actorUserId: string;
}) {
  if (!ANNOUNCEMENT_ICON_WHITELIST.includes(input.icon as (typeof ANNOUNCEMENT_ICON_WHITELIST)[number])) {
    throw new AnnouncementError("Ícone de categoria inválido");
  }
  if (!ANNOUNCEMENT_TONE_WHITELIST.includes(input.tone as (typeof ANNOUNCEMENT_TONE_WHITELIST)[number])) {
    throw new AnnouncementError("Tom de categoria inválido");
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new AnnouncementError("Nome de categoria inválido");
  if (input.id) {
    const updated = await prisma.announcementCategory.update({
      where: { id: input.id },
      data: {
        name,
        description: input.description?.trim() || null,
        icon: input.icon,
        tone: input.tone,
        sortOrder: input.sortOrder ?? undefined,
        isActive: input.isActive,
      },
      select: categorySelect,
    });
    await audit(input.actorUserId, "announcement.category_updated", updated.id);
    return updated;
  }
  let slug = slugifyTitle(name);
  const clash = await prisma.announcementCategory.findUnique({ where: { slug }, select: { id: true } });
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
  const created = await prisma.announcementCategory.create({
    data: {
      slug,
      name,
      description: input.description?.trim() || null,
      icon: input.icon,
      tone: input.tone,
      sortOrder: input.sortOrder ?? 100,
    },
    select: categorySelect,
  });
  await audit(input.actorUserId, "announcement.category_created", created.id);
  return created;
}

function toPublic(row: {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  coverUrl: string | null;
  priority: string;
  status: string;
  isFeatured: boolean;
  isPinned: boolean;
  notifyUsers: boolean;
  requiresAcknowledgement: boolean;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  expiresAt: Date | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; slug: string; name: string; description: string | null; icon: string; tone: string };
  reads?: { readAt: Date; acknowledgedAt: Date | null }[];
  targets?: { targetType: string; targetId: string }[];
}) {
  const read = row.reads?.[0];
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    content: row.content,
    coverUrl: row.coverUrl,
    priority: row.priority,
    status: row.status,
    isFeatured: row.isFeatured,
    isPinned: row.isPinned,
    notifyUsers: row.notifyUsers,
    requiresAcknowledgement: row.requiresAcknowledgement,
    publishedAt: row.publishedAt,
    scheduledAt: row.scheduledAt,
    expiresAt: row.expiresAt,
    ctaLabel: row.ctaLabel,
    ctaUrl: row.ctaUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    category: row.category,
    readAt: read?.readAt ?? null,
    acknowledgedAt: read?.acknowledgedAt ?? null,
    unread: !read,
    targets: row.targets?.map((t) => ({ targetType: t.targetType, targetId: t.targetId })) ?? undefined,
  };
}

export async function listForOrganization(input: {
  organizationId: string;
  userId: string;
  page: number;
  pageSize: number;
  q?: string;
  categorySlug?: string;
  unreadOnly?: boolean;
}) {
  const planId = await planIdForOrganization(input.organizationId);
  const now = new Date();
  const where = visibleWhere({ ...input, planId, now });
  const unreadWhere = visibleWhere({ ...input, planId, now, unreadOnly: true });
  const [total, unreadCount, rows] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.count({ where: unreadWhere }),
    prisma.announcement.findMany({
      where,
      orderBy: [{ isPinned: "desc" }, { isFeatured: "desc" }, { publishedAt: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        category: { select: categorySelect },
        reads: { where: { userId: input.userId }, select: { readAt: true, acknowledgedAt: true } },
      },
    }),
  ]);
  return {
    items: rows.map((row) => toPublic(row)),
    total,
    unreadCount,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function inboxForUser(organizationId: string, userId: string) {
  const planId = await planIdForOrganization(organizationId);
  const now = new Date();
  const where = visibleWhere({ organizationId, planId, now, userId, unreadOnly: true });
  const [count, items] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }],
      take: 5,
      select: {
        id: true,
        title: true,
        summary: true,
        publishedAt: true,
        priority: true,
        category: { select: { name: true, icon: true, tone: true } },
      },
    }),
  ]);
  return { count, items };
}

export async function getForOrganization(organizationId: string, userId: string, id: string) {
  const planId = await planIdForOrganization(organizationId);
  const now = new Date();
  const row = await prisma.announcement.findFirst({
    where: { id, ...visibleWhere({ organizationId, planId, now }) },
    include: {
      category: { select: categorySelect },
      reads: { where: { userId }, select: { readAt: true, acknowledgedAt: true } },
    },
  });
  if (!row) return null;
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId } },
    create: { announcementId: id, userId, readAt: now },
    update: {},
  });
  const read = row.reads[0] ?? { readAt: now, acknowledgedAt: null };
  return toPublic({ ...row, reads: [read] });
}

export async function acknowledgeForUser(organizationId: string, userId: string, id: string) {
  const planId = await planIdForOrganization(organizationId);
  const now = new Date();
  const row = await prisma.announcement.findFirst({
    where: { id, ...visibleWhere({ organizationId, planId, now }) },
    select: { id: true, requiresAcknowledgement: true },
  });
  if (!row) return null;
  if (!row.requiresAcknowledgement) throw new AnnouncementError("Esta publicação não exige confirmação");
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId } },
    create: { announcementId: id, userId, readAt: now, acknowledgedAt: now },
    update: { acknowledgedAt: now },
  });
  return { acknowledgedAt: now };
}

export async function markAllRead(organizationId: string, userId: string) {
  const planId = await planIdForOrganization(organizationId);
  const now = new Date();
  let marked = 0;
  for (let round = 0; round < 5; round++) {
    const rows = await prisma.announcement.findMany({
      where: visibleWhere({ organizationId, planId, now, userId, unreadOnly: true }),
      select: { id: true },
      take: 200,
    });
    if (rows.length === 0) break;
    const result = await prisma.announcementRead.createMany({
      data: rows.map((row) => ({ announcementId: row.id, userId, readAt: now })),
      skipDuplicates: true,
    });
    marked += result.count;
    if (rows.length < 200) break;
  }
  return { marked };
}

export async function previewAudience(audience: AudienceInput) {
  const targets = normalizeAudience(audience);
  await assertTargetsExist(targets);
  return countAudience(targets);
}

async function writeRow(
  input: AnnouncementWriteInput,
  actorUserId: string,
  existingId?: string,
) {
  const parsed = validateWrite(input);
  await assertTargetsExist(parsed.targets);
  const category = await prisma.announcementCategory.findFirst({
    where: { id: input.categoryId, isActive: true },
    select: { id: true },
  });
  if (!category) throw new AnnouncementError("Categoria inválida");

  const now = new Date();
  const existing = existingId
    ? await prisma.announcement.findFirst({ where: { id: existingId, deletedAt: null } })
    : null;
  if (existingId && !existing) throw new AnnouncementError("Publicação não encontrada", 404);
  const goingLive =
    input.action === "publish" ||
    input.action === "schedule" ||
    (input.action === "draft" && existing?.status === "PUBLISHED");
  await assertHighlightLimits({
    isFeatured: input.isFeatured,
    isPinned: input.isPinned,
    ignoreId: existingId,
    applying: goingLive,
  });
  if (existing && existing.status === "ARCHIVED" && input.action !== "draft") {
    throw new AnnouncementError("Arquivada: duplique ou volte para rascunho antes de publicar");
  }
  if (existing?.status === "PUBLISHED" && input.action === "schedule") {
    throw new AnnouncementError("Uma publicação já publicada não pode ser reagendada por este fluxo");
  }

  let status: "DRAFT" | "SCHEDULED" | "PUBLISHED" = "DRAFT";
  let publishedAt = existing?.publishedAt ?? null;
  let scheduledAt = parsed.scheduledAt;
  let publishedById = existing?.publishedById ?? null;
  if (input.action === "draft" && existing?.status === "PUBLISHED") {
    status = "PUBLISHED";
    scheduledAt = null;
  } else if (input.action === "publish") {
    status = "PUBLISHED";
    publishedAt = existing?.status === "PUBLISHED" ? existing.publishedAt ?? now : now;
    scheduledAt = null;
    publishedById = existing?.status === "PUBLISHED" ? existing.publishedById : actorUserId;
  } else if (input.action === "schedule") {
    status = "SCHEDULED";
    publishedAt = null;
    publishedById = null;
  }

  if (parsed.expiresAt && publishedAt && parsed.expiresAt <= publishedAt && status === "PUBLISHED") {
    throw new AnnouncementError("A validade precisa ser posterior à publicação");
  }

  const slug = existing ? existing.slug : await uniqueSlug(input.title);
  const data = {
    title: input.title.trim(),
    slug,
    summary: input.summary.trim(),
    content: parsed.content,
    categoryId: input.categoryId,
    coverUrl: parsed.coverUrl,
    priority: input.priority,
    status,
    isFeatured: input.isFeatured,
    isPinned: input.isPinned,
    notifyUsers: input.notifyUsers,
    requiresAcknowledgement: input.requiresAcknowledgement,
    publishedAt,
    scheduledAt,
    expiresAt: parsed.expiresAt,
    ctaLabel: parsed.ctaLabel,
    ctaUrl: parsed.ctaUrl,
    updatedById: actorUserId,
    publishedById,
  };

  const saved = await prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.announcement.update({ where: { id: existing.id }, data })
      : await tx.announcement.create({
          data: { ...data, createdById: actorUserId },
        });
    await tx.announcementTarget.deleteMany({ where: { announcementId: row.id } });
    await tx.announcementTarget.createMany({
      data: parsed.targets.map((target) => ({
        announcementId: row.id,
        targetType: target.targetType,
        targetId: target.targetId,
      })),
    });
    return row;
  });

  const becamePublished = status === "PUBLISHED" && existing?.status !== "PUBLISHED";
  await audit(actorUserId, existing ? "announcement.updated" : "announcement.created", saved.id, {
    status,
    action: input.action,
  });
  if (becamePublished) await audit(actorUserId, "announcement.published", saved.id);
  if (status === "SCHEDULED" && existing?.status !== "SCHEDULED") {
    await audit(actorUserId, "announcement.scheduled", saved.id, {
      scheduledAt: scheduledAt?.toISOString(),
    });
  }

  const full = await prisma.announcement.findUniqueOrThrow({
    where: { id: saved.id },
    include: listInclude,
  });
  return { announcement: toPublic(full), shouldNotify: becamePublished && input.notifyUsers };
}

export async function createAnnouncement(input: AnnouncementWriteInput, actorUserId: string) {
  return writeRow(input, actorUserId);
}

export async function updateAnnouncement(id: string, input: AnnouncementWriteInput, actorUserId: string) {
  return writeRow(input, actorUserId, id);
}

export async function publishDueAnnouncements(limit = 20): Promise<string[]> {
  const now = new Date();
  const due = await prisma.announcement.findMany({
    where: { deletedAt: null, status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true, notifyUsers: true, publishedById: true, createdById: true },
  });
  const notifyIds: string[] = [];
  for (const row of due) {
    const updated = await prisma.announcement.updateMany({
      where: { id: row.id, status: "SCHEDULED" },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        publishedById: row.publishedById ?? row.createdById,
        scheduledAt: null,
      },
    });
    if (updated.count === 0) continue;
    await audit(row.createdById, "announcement.published", row.id, { via: "scheduler" });
    if (row.notifyUsers) notifyIds.push(row.id);
  }
  return notifyIds;
}

export async function adminList(input: {
  page: number;
  pageSize: number;
  status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  q?: string;
  categoryId?: string;
}) {
  const where: Prisma.AnnouncementWhereInput = { deletedAt: null };
  if (input.status) where.status = input.status;
  if (input.categoryId) where.categoryId = input.categoryId;
  const q = input.q?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
      { content: { contains: q, mode: "insensitive" } },
    ];
  }
  const [total, rows, grouped] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        category: { select: { id: true, name: true, slug: true, description: true, icon: true, tone: true } },
        targets: true,
        _count: { select: { reads: true } },
      },
    }),
    prisma.announcement.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const counts = { DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0, ARCHIVED: 0 };
  for (const row of grouped) counts[row.status] = row._count._all;
  return {
    items: rows.map((row) => ({
      ...toPublic(row),
      readCount: row._count.reads,
      audienceLabel: audienceLabel(row.targets),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    counts,
  };
}

function audienceLabel(targets: { targetType: string; targetId: string }[]): string {
  if (targets.some((t) => t.targetType === "ALL")) return "ALL";
  if (targets.some((t) => t.targetType === "PLAN")) return "PLANS";
  return "ORGANIZATIONS";
}

export async function adminGet(id: string) {
  const row = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...listInclude,
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
      publishedBy: { select: { id: true, name: true, email: true } },
      archivedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!row) return null;
  return {
    ...toPublic(row),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    publishedBy: row.publishedBy,
    archivedBy: row.archivedBy,
    archivedAt: row.archivedAt,
  };
}

export async function archiveAnnouncement(id: string, actorUserId: string) {
  const existing = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new AnnouncementError("Publicação não encontrada", 404);
  await prisma.announcement.update({
    where: { id },
    data: { status: "ARCHIVED", archivedById: actorUserId, archivedAt: new Date(), updatedById: actorUserId },
  });
  await audit(actorUserId, "announcement.archived", id);
}

export async function softDeleteAnnouncement(id: string, actorUserId: string) {
  const existing = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new AnnouncementError("Publicação não encontrada", 404);
  await prisma.announcement.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actorUserId, status: "ARCHIVED" },
  });
  await audit(actorUserId, "announcement.deleted", id);
}

export async function duplicateAnnouncement(id: string, actorUserId: string) {
  const existing = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: { targets: true },
  });
  if (!existing) throw new AnnouncementError("Publicação não encontrada", 404);
  const title = existing.title.startsWith("Cópia: ") ? existing.title : `Cópia: ${existing.title}`.slice(0, 180);
  const created = await prisma.announcement.create({
    data: {
      title,
      slug: await uniqueSlug(title),
      summary: existing.summary,
      content: existing.content,
      categoryId: existing.categoryId,
      coverUrl: existing.coverUrl,
      priority: existing.priority,
      status: "DRAFT",
      isFeatured: false,
      isPinned: false,
      notifyUsers: existing.notifyUsers,
      requiresAcknowledgement: existing.requiresAcknowledgement,
      expiresAt: existing.expiresAt,
      ctaLabel: existing.ctaLabel,
      ctaUrl: existing.ctaUrl,
      createdById: actorUserId,
      updatedById: actorUserId,
      targets: {
        create: existing.targets.map((target) => ({
          targetType: target.targetType,
          targetId: target.targetId,
        })),
      },
    },
    include: listInclude,
  });
  await audit(actorUserId, "announcement.duplicated", created.id, { sourceId: id });
  return toPublic(created);
}

export async function renotifyAnnouncement(id: string, actorUserId: string) {
  const existing = await prisma.announcement.findFirst({
    where: { id, deletedAt: null, status: "PUBLISHED" },
    include: { targets: true },
  });
  if (!existing) throw new AnnouncementError("Só é possível notificar novamente uma publicação ativa", 404);
  await prisma.announcementRead.deleteMany({ where: { announcementId: id } });
  await prisma.announcement.update({
    where: { id },
    data: { notifyUsers: true, updatedById: actorUserId },
  });
  await audit(actorUserId, "announcement.renotified", id);
  return existing.targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId }));
}

export async function metricsForAnnouncement(id: string) {
  const row = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: { targets: true },
  });
  if (!row) return null;
  const targets = row.targets.map((t) => ({
    targetType: t.targetType as AnnouncementAudienceTarget["targetType"],
    targetId: t.targetId,
  }));
  const audience = await countAudience(targets);
  const [reads, acknowledgements] = await Promise.all([
    prisma.announcementRead.count({ where: { announcementId: id } }),
    prisma.announcementRead.count({ where: { announcementId: id, acknowledgedAt: { not: null } } }),
  ]);
  const readRate = audience.users > 0 ? Math.round((reads / audience.users) * 1000) / 10 : 0;
  return {
    organizations: audience.organizations,
    eligibleUsers: audience.users,
    reads,
    acknowledgements,
    readRate,
  };
}

export async function targetsForAnnouncement(id: string): Promise<AnnouncementAudienceTarget[] | null> {
  const row = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: { targets: true },
  });
  if (!row) return null;
  return row.targets.map((t) => ({
    targetType: t.targetType as AnnouncementAudienceTarget["targetType"],
    targetId: t.targetId,
  }));
}

export async function searchOrganizations(q: string) {
  const query = q.trim();
  return prisma.organization.findMany({
    where: {
      isActive: true,
      ...(query
        ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { slug: { contains: query, mode: "insensitive" } }] }
        : {}),
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

export async function listActivePlans() {
  return prisma.plan.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}
