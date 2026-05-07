import { randomBytes } from "node:crypto";
import { PrismaClient, InboxChannelType } from "@prisma/client";
import bcrypt from "bcrypt";
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_TAGS,
  DEFAULT_LEAD_TYPES,
  BCRYPT_COST_FACTOR,
} from "@openconduit/shared";

const prisma = new PrismaClient();

/** Mesmo nome que `defaultInbox.ts` — seed não importa `src/lib` (imagens Docker podem não incluir `src`). */
const DEFAULT_INBOX_NAME = "Caixa principal";

/** Gera token de ingestão (alinhado a `channelInboxIngest.newIngestToken`, sem importar `src`). */
function seedNewIngestToken(): string {
  return randomBytes(32).toString("hex");
}

async function seedEnsureDefaultInbox(organizationId: string): Promise<{ id: string }> {
  const existing = await prisma.inbox.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const inbox = await tx.inbox.create({
      data: {
        organizationId,
        name: DEFAULT_INBOX_NAME,
        channelType: InboxChannelType.WHATSAPP,
        isDefault: true,
        ingestToken: seedNewIngestToken(),
      },
    });
    const users = await tx.user.findMany({
      where: { organizationId },
      select: { id: true },
    });
    if (users.length > 0) {
      await tx.inboxMember.createMany({
        data: users.map((u) => ({ inboxId: inbox.id, userId: u.id })),
        skipDuplicates: true,
      });
    }
    return inbox;
  });
}

async function seedAddUserToDefaultInboxes(organizationId: string, userId: string): Promise<void> {
  let defaults = await prisma.inbox.findMany({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (defaults.length === 0) {
    await seedEnsureDefaultInbox(organizationId);
    defaults = await prisma.inbox.findMany({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
  }
  await prisma.inboxMember.createMany({
    data: defaults.map((i) => ({ inboxId: i.id, userId })),
    skipDuplicates: true,
  });
}

async function main() {
  console.log("Seeding database...");

  let org = await prisma.organization.findUnique({ where: { id: DEFAULT_ORGANIZATION_ID } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: DEFAULT_ORGANIZATION_ID,
        name: "Organização padrão",
        slug: "default",
        isActive: true,
      },
    });
    console.log("Default organization created");
  }

  const settings = await prisma.settings.findUnique({ where: { organizationId: org.id } });
  if (!settings) {
    await prisma.settings.create({ data: { organizationId: org.id } });
    console.log("Default settings row created");
  }

  let pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: org.id, isDefault: true },
  });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: {
        organizationId: org.id,
        name: "Pipeline principal",
        isDefault: true,
        sortOrder: 0,
      },
    });
  }

  const stageCount = await prisma.pipelineStage.count({ where: { pipelineId: pipeline.id } });
  if (stageCount === 0) {
    for (const stage of DEFAULT_PIPELINE_STAGES) {
      await prisma.pipelineStage.create({
        data: {
          pipelineId: pipeline.id,
          name: stage.name,
          order: stage.order,
          color: stage.color,
          probabilityPct: stage.probabilityPct,
        },
      });
    }
    console.log("Pipeline stages seeded");
  }

  const ltCount = await prisma.leadType.count({ where: { organizationId: org.id } });
  if (ltCount === 0) {
    for (const lt of DEFAULT_LEAD_TYPES) {
      await prisma.leadType.create({
        data: {
          organizationId: org.id,
          name: lt.name,
          color: lt.color,
          order: lt.order,
          valueRollup: lt.valueRollup,
        },
      });
    }
    console.log("Lead types seeded");
  }

  const tagCount = await prisma.tag.count({ where: { organizationId: org.id } });
  if (tagCount === 0) {
    for (const tag of DEFAULT_TAGS) {
      await prisma.tag.create({
        data: { organizationId: org.id, name: tag.name, color: tag.color },
      });
    }
    await prisma.tag.create({
      data: { organizationId: org.id, name: "Desconhecido", color: "#9ca3af" },
    });
    console.log("Tags seeded");
  }

  const adminCount = await prisma.user.count({
    where: { organizationId: org.id, role: "ADMIN" },
  });
  if (adminCount === 0) {
    const passwordHash = await bcrypt.hash("admin123", BCRYPT_COST_FACTOR);
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Admin",
        email: "admin@openconduit.dev",
        passwordHash,
        role: "ADMIN",
      },
    });
    console.log("Default admin created (admin@openconduit.dev / admin123)");
    console.log("IMPORTANT: Change this password immediately after first login!");
  }

  await prisma.user.updateMany({
    where: { organizationId: null, role: { in: ["ADMIN", "AGENT"] } },
    data: { organizationId: org.id },
  });

  if (process.env.SEED_SUPER_ADMIN === "1") {
    const superEmail = process.env.SUPER_ADMIN_EMAIL ?? "super@openconduit.dev";
    const existingSuper = await prisma.user.findUnique({ where: { email: superEmail } });
    if (!existingSuper) {
      const passwordHash = await bcrypt.hash(
        process.env.SUPER_ADMIN_PASSWORD ?? "super123",
        BCRYPT_COST_FACTOR,
      );
      await prisma.user.create({
        data: {
          name: "Super Admin",
          email: superEmail,
          passwordHash,
          role: "SUPER_ADMIN",
        },
      });
      console.log(`Super admin created (${superEmail}) — set SEED_SUPER_ADMIN only in controlled environments.`);
    }
  }

  await seedEnsureDefaultInbox(org.id);
  const orgUsers = await prisma.user.findMany({
    where: { organizationId: org.id },
    select: { id: true },
  });
  for (const u of orgUsers) {
    await seedAddUserToDefaultInboxes(org.id, u.id);
  }

  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
