import { FastifyInstance } from "fastify";
import { authenticatePlatformApplication } from "../middleware/platformAppAuth.js";
import { prisma } from "../db.js";

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me", { preHandler: [authenticatePlatformApplication] }, async (request) => {
    const appCtx = request.platformApplication!;
    return {
      applicationId: appCtx.id,
      name: appCtx.name,
      apiVersion: "1",
    };
  });

  app.get("/stats", { preHandler: [authenticatePlatformApplication] }, async () => {
    const [organizations, contacts, conversationsOpen] = await Promise.all([
      prisma.organization.count({ where: { isActive: true } }),
      prisma.contact.count(),
      prisma.conversation.count({ where: { status: "OPEN" } }),
    ]);
    return {
      organizationsActive: organizations,
      contactsTotal: contacts,
      conversationsOpen,
    };
  });
}
