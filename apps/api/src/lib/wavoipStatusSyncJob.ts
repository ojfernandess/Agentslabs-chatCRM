import type { FastifyBaseLogger } from "fastify";
import { subHours, subMinutes } from "date-fns";
import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { logWavoipIntegration } from "./wavoipIntegrationLog.js";
import {
  checkEvolutionInstanceConnection,
  resolveEvolutionBridgeFromDevice,
} from "./wavoipEvolutionBridge.js";

/** Observabilidade: alertas de devices parados e revalidação periódica do bridge Evolution. */
export async function runWavoipStatusSyncTick(log: FastifyBaseLogger): Promise<void> {
  const staleThreshold = subMinutes(new Date(), 45);
  const revalidateBefore = subHours(new Date(), 6);

  const staleDevices = await prisma.wavoipDevice.findMany({
    where: {
      status: { in: ["CONNECTING", "BUILDING", "RESTARTING"] },
      OR: [{ lastStatusAt: { lt: staleThreshold } }, { lastStatusAt: null, updatedAt: { lt: staleThreshold } }],
    },
    take: 25,
  });

  for (const device of staleDevices) {
    const enabled = await isOrganizationFeatureEnabled(device.organizationId, "wavoip_voice");
    if (!enabled) continue;

    await logWavoipIntegration({
      organizationId: device.organizationId,
      wavoipDeviceId: device.id,
      level: "warn",
      eventType: "status_sync_stale",
      message: `Device stuck in ${device.status} — check QR / external bridge / Wavoip panel`,
      payload: {
        status: device.status,
        lastStatusAt: device.lastStatusAt?.toISOString() ?? null,
      },
    });
  }

  const bridgeDevices = await prisma.wavoipDevice.findMany({
    where: {
      connectionMode: "EXTERNAL_EVOLUTION",
      status: { in: ["OPEN", "EXTERNAL_INTEGRATION_ERROR"] },
    },
    take: 20,
  });

  for (const device of bridgeDevices) {
    const enabled = await isOrganizationFeatureEnabled(device.organizationId, "wavoip_voice");
    if (!enabled) continue;

    const cfg = device.externalConfig as Record<string, unknown> | null;
    const lastValidation = cfg?.lastValidation as { at?: string } | undefined;
    const lastAt = lastValidation?.at ? new Date(lastValidation.at) : null;
    if (lastAt && lastAt > revalidateBefore) continue;

    const creds = resolveEvolutionBridgeFromDevice(device);
    if (!creds) continue;

    const validation = await checkEvolutionInstanceConnection(creds);
    const now = new Date().toISOString();
    await prisma.wavoipDevice.update({
      where: { id: device.id },
      data: {
        externalConfig: {
          ...(cfg ?? {}),
          lastValidation: {
            ok: validation.ok,
            connectionState: validation.connectionState,
            message: validation.message,
            at: now,
            source: "background_sync",
          },
        },
        ...(validation.ok
          ? { lastError: null }
          : { lastError: `Evolution bridge: ${validation.message}` }),
      },
    });

    await logWavoipIntegration({
      organizationId: device.organizationId,
      wavoipDeviceId: device.id,
      level: validation.ok ? "info" : "warn",
      eventType: "status_sync_bridge",
      message: `Background Evolution validation → ${validation.message}`,
      payload: validation as unknown as Record<string, unknown>,
    });
  }

  if (staleDevices.length > 0 || bridgeDevices.length > 0) {
    log.debug(
      { stale: staleDevices.length, bridgeChecked: bridgeDevices.length },
      "wavoip status sync tick completed",
    );
  }
}
