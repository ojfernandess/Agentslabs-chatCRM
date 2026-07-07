import type { FastifyInstance } from "fastify";
import { getPublicTurnstileConfig } from "../lib/turnstileSettings.js";

export async function publicTurnstileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/turnstile-config", async () => {
    return getPublicTurnstileConfig();
  });
}
