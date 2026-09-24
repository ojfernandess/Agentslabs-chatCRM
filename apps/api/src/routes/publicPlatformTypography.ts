import type { FastifyInstance } from "fastify";
import { getPublicPlatformTypography } from "../lib/platformTypographySettings.js";

export async function publicPlatformTypographyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/platform-typography", async () => {
    return getPublicPlatformTypography();
  });
}
