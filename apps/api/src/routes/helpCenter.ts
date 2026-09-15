import type { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { getHelpCenterConfig, toPublicHelpCenterConfig } from "../lib/helpCenterSettings.js";

export async function helpCenterRoutes(app: FastifyInstance) {
  app.get("/config", { preHandler: [authenticate] }, async () => {
    const config = await getHelpCenterConfig();
    return toPublicHelpCenterConfig(config);
  });
}
