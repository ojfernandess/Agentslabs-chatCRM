import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { normalizeLeadFinderPhone } from "./leadFinderPhone.js";
import { ensurePipelineStageForLeadType } from "./pipelineLeadTypeSync.js";
import { fireBroadcastEventTriggers } from "./broadcastEventHooks.js";

export interface LeadFinderImportLead {
  placeId?: string | null;
  title: string;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  email?: string | null;
  type?: string | null;
  rating?: number | null;
  city?: string | null;
}

export interface LeadFinderImportOptions {
  leads: LeadFinderImportLead[];
  tagIds?: string[];
  leadTypeId?: string | null;
  createImportTag?: boolean;
  importTagName?: string;
  updateExisting?: boolean;
  createdById?: string;
  /** Cidade da pesquisa (nicho + cidade), usada quando o lead não traz cidade explícita. */
  searchCity?: string | null;
}

function mergeCityMetadata(current: unknown, city: string | null | undefined): Prisma.InputJsonValue {
  const base: Record<string, unknown> =
    current != null && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  if (city === undefined) return base as Prisma.InputJsonValue;
  if (city === null || !city.trim()) {
    delete base.city;
    delete base.cidade;
    delete base.municipio;
  } else {
    base.city = city.trim();
  }
  return base as Prisma.InputJsonValue;
}

/** Extrai cidade do endereço (último segmento após vírgula) ou usa fallback da pesquisa. */
export function resolveLeadFinderCity(lead: LeadFinderImportLead, searchCity?: string | null): string | null {
  const explicit = lead.city?.trim();
  if (explicit) return explicit.slice(0, 120);
  const fromSearch = searchCity?.trim();
  if (fromSearch) return fromSearch.slice(0, 120);
  const addr = lead.address?.trim();
  if (!addr) return null;
  const parts = addr
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 1].slice(0, 120);
  }
  return null;
}

function contactNotesFromLead(lead: LeadFinderImportLead): string {
  const lines: string[] = ["[Lead Finder]"];
  if (lead.type) lines.push(`Tipo: ${lead.type}`);
  if (lead.address) lines.push(`Endereço: ${lead.address}`);
  if (lead.placeId) lines.push(`Google Place ID: ${lead.placeId}`);
  if (lead.rating != null) lines.push(`Avaliação: ${lead.rating}`);
  return lines.join("\n");
}

async function findOrCreateAccountForLead(
  organizationId: string,
  companyName: string,
  opts: { website?: string | null; city?: string | null },
): Promise<string> {
  const name = companyName.trim().slice(0, 255);
  const website = opts.website?.trim().slice(0, 512) || null;
  const city = opts.city?.trim().slice(0, 120) || null;

  let account = await prisma.account.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
  });

  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: {
        ...(website ? { website } : {}),
        ...(city !== null ? { metadata: mergeCityMetadata(account.metadata, city) } : {}),
      },
    });
    return account.id;
  }

  account = await prisma.account.create({
    data: {
      organizationId,
      name,
      website,
      ...(city ? { metadata: mergeCityMetadata(null, city) } : {}),
    },
  });
  return account.id;
}

async function syncLeadFinderAccountOnContact(
  organizationId: string,
  contact: { id: string; accountId: string | null; name: string; notes: string | null },
  lead: LeadFinderImportLead,
  searchCity: string | null | undefined,
  updateExisting: boolean,
): Promise<void> {
  const companyName = lead.title.trim().slice(0, 255);
  const city = resolveLeadFinderCity(lead, searchCity);
  const website = lead.website?.trim() || null;
  const notes = contactNotesFromLead(lead);

  if (contact.accountId) {
    if (!updateExisting) return;
    const acc = await prisma.account.findFirst({ where: { id: contact.accountId, organizationId } });
    if (!acc) return;
    await prisma.account.update({
      where: { id: acc.id },
      data: {
        name: companyName,
        ...(website ? { website } : {}),
        ...(city ? { metadata: mergeCityMetadata(acc.metadata, city) } : {}),
      },
    });
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        notes: contact.notes ? `${contact.notes}\n\n${notes}` : notes,
        ...(lead.email?.trim() ? { email: lead.email.trim() } : {}),
      },
    });
    return;
  }

  const accountId = await findOrCreateAccountForLead(organizationId, companyName, { website, city });
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      accountId,
      notes: contact.notes ? `${contact.notes}\n\n${notes}` : notes,
      ...(lead.email?.trim() ? { email: lead.email.trim() } : {}),
    },
  });
}

export async function importLeadFinderContacts(
  app: FastifyInstance,
  organizationId: string,
  options: LeadFinderImportOptions,
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  skippedDetails: { title: string; reason: string }[];
  contactIds: string[];
  tagIds: string[];
}> {
  let tagIds = [...(options.tagIds ?? [])];

  if (options.createImportTag) {
    const tagName = (options.importTagName?.trim() || `Lead Finder ${new Date().toISOString().slice(0, 10)}`).slice(0, 100);
    const existingTag = await prisma.tag.findFirst({ where: { organizationId, name: tagName } });
    if (existingTag) {
      if (!tagIds.includes(existingTag.id)) tagIds.push(existingTag.id);
    } else {
      const created = await prisma.tag.create({
        data: { organizationId, name: tagName, color: "#6366f1" },
      });
      tagIds.push(created.id);
    }
  }

  if (options.leadTypeId) {
    const lt = await prisma.leadType.findFirst({ where: { id: options.leadTypeId, organizationId } });
    if (!lt) throw new Error("Invalid leadTypeId");
  }

  if (tagIds.length > 0) {
    const count = await prisma.tag.count({ where: { organizationId, id: { in: tagIds } } });
    if (count !== tagIds.length) throw new Error("Invalid tagIds");
  }

  let pipelineStageId: string | null = null;
  if (options.leadTypeId) {
    const stage = await ensurePipelineStageForLeadType(prisma, organizationId, options.leadTypeId);
    pipelineStageId = stage.id;
  }

  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const skipped: { title: string; reason: string }[] = [];

  for (const lead of options.leads) {
    const phone = normalizeLeadFinderPhone(lead.phone ?? "");
    if (!phone) {
      skipped.push({ title: lead.title, reason: "no_phone" });
      continue;
    }

    const companyName = lead.title.trim().slice(0, 255);
    const city = resolveLeadFinderCity(lead, options.searchCity);
    const website = lead.website?.trim() || null;
    const notes = contactNotesFromLead(lead);
    const existing = await prisma.contact.findFirst({
      where: { organizationId, phone },
      select: { id: true, accountId: true, name: true, notes: true },
    });

    if (existing) {
      if (!options.updateExisting) {
        skipped.push({ title: lead.title, reason: "duplicate" });
        continue;
      }
      await syncLeadFinderAccountOnContact(
        organizationId,
        existing,
        lead,
        options.searchCity,
        true,
      );
      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: lead.title,
          ...(pipelineStageId ? { pipelineStageId } : {}),
        },
      });
      if (tagIds.length > 0) {
        await prisma.contactTag.createMany({
          data: tagIds.map((tagId) => ({ contactId: updated.id, tagId })),
          skipDuplicates: true,
        });
      }
      updatedIds.push(updated.id);
      continue;
    }

    const accountId = await findOrCreateAccountForLead(organizationId, companyName, { website, city });

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: lead.title,
        notes,
        email: lead.email?.trim() || null,
        accountId,
        pipelineStageId,
        createdById: options.createdById ?? null,
        tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
    });
    createdIds.push(contact.id);
    fireBroadcastEventTriggers(app, organizationId, "NEW_LEAD", { contactId: contact.id });
  }

  return {
    created: createdIds.length,
    updated: updatedIds.length,
    skipped: skipped.length,
    skippedDetails: skipped,
    contactIds: [...createdIds, ...updatedIds],
    tagIds,
  };
}
