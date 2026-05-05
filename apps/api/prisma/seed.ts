import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_TAGS,
  DEFAULT_LEAD_TYPES,
  BCRYPT_COST_FACTOR,
} from "@openconduit/shared";

const prisma = new PrismaClient();

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

  const stageCount = await prisma.pipelineStage.count({ where: { organizationId: org.id } });
  if (stageCount === 0) {
    for (const stage of DEFAULT_PIPELINE_STAGES) {
      await prisma.pipelineStage.create({
        data: {
          organizationId: org.id,
          name: stage.name,
          order: stage.order,
          color: stage.color,
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
