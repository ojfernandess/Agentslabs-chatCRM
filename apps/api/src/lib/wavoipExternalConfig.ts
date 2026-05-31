import type { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "./encryption.js";
import { MASKED_WAVOIP_SECRET } from "./wavoipDeviceConfig.js";

export type WavoipExternalConfigFields = {
  evolutionUrl?: string | null;
  evolutionApiKey?: string | null;
  evolutionInstance?: string | null;
};

export type WavoipBridgeStatusClient = {
  syncedAt: string | null;
  provisionedAt: string | null;
  sourceInboxId: string | null;
  evolutionTokenSetAt: string | null;
  lastValidation: {
    ok: boolean;
    connectionState: string | null;
    message: string | null;
    at: string | null;
  } | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseExternalConfig(raw: unknown): WavoipExternalConfigFields {
  const c = asRecord(raw);
  if (!c) return {};
  return {
    evolutionUrl: typeof c.evolutionUrl === "string" ? c.evolutionUrl : null,
    evolutionApiKey: typeof c.evolutionApiKey === "string" ? c.evolutionApiKey : null,
    evolutionInstance: typeof c.evolutionInstance === "string" ? c.evolutionInstance : null,
  };
}

export function maskExternalConfigForClient(raw: unknown): WavoipExternalConfigFields {
  const parsed = parseExternalConfig(raw);
  return {
    evolutionUrl: parsed.evolutionUrl ?? null,
    evolutionInstance: parsed.evolutionInstance ?? null,
    evolutionApiKey: parsed.evolutionApiKey ? MASKED_WAVOIP_SECRET : null,
  };
}

export function bridgeStatusFromExternalConfig(raw: unknown): WavoipBridgeStatusClient {
  const c = asRecord(raw);
  const lastValidation = asRecord(c?.lastValidation);
  return {
    syncedAt: typeof c?.bridgeSyncedAt === "string" ? c.bridgeSyncedAt : null,
    provisionedAt: typeof c?.bridgeProvisionedAt === "string" ? c.bridgeProvisionedAt : null,
    sourceInboxId: typeof c?.bridgeSourceInboxId === "string" ? c.bridgeSourceInboxId : null,
    evolutionTokenSetAt:
      typeof c?.evolutionWavoipTokenSetAt === "string" ? c.evolutionWavoipTokenSetAt : null,
    lastValidation: lastValidation
      ? {
          ok: lastValidation.ok === true,
          connectionState:
            typeof lastValidation.connectionState === "string" ? lastValidation.connectionState : null,
          message: typeof lastValidation.message === "string" ? lastValidation.message : null,
          at: typeof lastValidation.at === "string" ? lastValidation.at : null,
        }
      : null,
  };
}

export function prepareExternalConfigForSave(
  incoming: WavoipExternalConfigFields | undefined,
  current: unknown,
): Prisma.InputJsonValue | undefined {
  if (incoming === undefined) return undefined;

  const cur = parseExternalConfig(current);
  const next: Record<string, unknown> = { ...(asRecord(current) ?? {}) };

  if (incoming.evolutionUrl !== undefined) {
    const v = incoming.evolutionUrl?.trim() ?? "";
    if (v) next.evolutionUrl = v.slice(0, 512);
  } else if (cur.evolutionUrl) {
    next.evolutionUrl = cur.evolutionUrl;
  }

  if (incoming.evolutionInstance !== undefined) {
    const v = incoming.evolutionInstance?.trim() ?? "";
    if (v) next.evolutionInstance = v.slice(0, 120);
  } else if (cur.evolutionInstance) {
    next.evolutionInstance = cur.evolutionInstance;
  }

  if (incoming.evolutionApiKey !== undefined) {
    const v = incoming.evolutionApiKey?.trim() ?? "";
    if (v && v !== MASKED_WAVOIP_SECRET) {
      next.evolutionApiKey = encrypt(v);
    } else if (cur.evolutionApiKey) {
      const stored = decrypt(cur.evolutionApiKey) ?? cur.evolutionApiKey;
      if (stored.includes(":")) next.evolutionApiKey = stored;
      else next.evolutionApiKey = encrypt(stored);
    }
  } else if (cur.evolutionApiKey) {
    next.evolutionApiKey = cur.evolutionApiKey;
  }

  return next as Prisma.InputJsonValue;
}

export function externalConfigBridgeInstructions(mode: string): string[] {
  if (mode === "EXTERNAL_EVOLUTION") {
    return [
      "No painel Wavoip, configure WhatsApp Externo → Evolution com URL, API Key e Instance.",
      "Use a mesma instância Evolution do inbox WhatsApp vinculado — não conecte dois devices Wavoip na mesma instância.",
      "Desconecte o device antigo antes de migrar a sessão.",
    ];
  }
  if (mode === "EXTERNAL_BAILEYS") {
    return [
      "Configure WhatsApp Externo → Baileys no painel Wavoip com a sessão existente.",
      "Mantenha a sessão na sua infraestrutura; a Wavoip usa a ponte apenas para chamadas.",
    ];
  }
  if (mode === "SIP") {
    return [
      "Configure um tronco SIP no seu PABX usando as credenciais abaixo.",
      "CallerID deve ser igual ao número WhatsApp conectado no dispositivo.",
    ];
  }
  return [];
}
