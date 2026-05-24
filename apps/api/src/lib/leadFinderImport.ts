import type { FastifyInstance } from "fastify";
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
}

export interface LeadFinderImportOptions {
  leads: LeadFinderImportLead[];
  tagIds?: string[];
  leadTypeId?: string | null;
  createImportTag?: boolean;
  importTagName?: string;
  updateExisting?: boolean;
  createdById?: string;
}

function contactNotesFromLead(lead: LeadFinderImportLead): string {
  const lines: string[] = ["[Lead Finder]"];
  if (lead.type) lines.push(`Tipo: ${lead.type}`);
  if (lead.address) lines.push(`Endereço: ${lead.address}`);
  if (lead.website) lines.push(`Site: ${lead.website}`);
  if (lead.placeId) lines.push(`Google Place ID: ${lead.placeId}`);
  if (lead.rating != null) lines.push(`Avaliação: ${lead.rating}`);
  return lines.join("\n");
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

    const notes = contactNotesFromLead(lead);
    const existing = await prisma.contact.findFirst({ where: { organizationId, phone } });

    if (existing) {
      if (!options.updateExisting) {
        skipped.push({ title: lead.title, reason: "duplicate" });
        continue;
      }
      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: lead.title,
          notes: existing.notes ? `${existing.notes}\n\n${notes}` : notes,
          ...(lead.email?.trim() ? { email: lead.email.trim() } : {}),
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

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: lead.title,
        notes,
        email: lead.email?.trim() || null,
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
