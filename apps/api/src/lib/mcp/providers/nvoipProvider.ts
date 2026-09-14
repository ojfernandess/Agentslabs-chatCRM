import { prisma } from "../../../db.js";
import { isAnyNvoipFeatureEnabled } from "../../featureFlags.js";
import { accountToClientRow, decryptNvoipSecret } from "../../nvoipConfig.js";
import { buildNvoipOrgInsights } from "../../nvoipInsights.js";
import { listNvoipTrunks, trunkToClient } from "../../nvoipTrunks.js";
import {
  nvoipGetBalance,
  nvoipListDids,
  testNvoipConnection,
} from "../../nvoipClient.js";
import { getNvoipWhatsappAvailability, listNvoipWhatsappTemplates } from "../../nvoipWhatsapp.js";
import { listCachedNvoipSipUsers } from "../../nvoipDirectorySync.js";
import { buildNvoipPabxTrunkInfo, maskNvoipTrunkPasswordForClient } from "../../nvoipPabxTrunkInfo.js";
import { readNvoipExternalConfig } from "../../nvoipExternalConfig.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export type NvoipMcpAction =
  | "account"
  | "insights"
  | "logs"
  | "trunks"
  | "dids"
  | "balance"
  | "test_connection"
  | "whatsapp"
  | "sip_users"
  | "pabx_trunk";

const NVOIP_ACTIONS: NvoipMcpAction[] = [
  "account",
  "insights",
  "logs",
  "trunks",
  "dids",
  "balance",
  "test_connection",
  "whatsapp",
  "sip_users",
  "pabx_trunk",
];

async function requireNvoipEnabled(organizationId: string): Promise<void> {
  const enabled = await isAnyNvoipFeatureEnabled(organizationId);
  if (!enabled) throw new Error("nvoip_disabled_for_organization");
}

async function loadAccount(organizationId: string) {
  const row = await prisma.nvoipAccount.findUnique({
    where: { organizationId },
    include: { inbox: { select: { name: true } } },
  });
  if (!row) throw new Error("nvoip_account_not_configured");
  return row;
}

async function searchNvoip(ctx: McpAuthContext, params: McpProviderSearchParams): Promise<unknown> {
  await requireNvoipEnabled(ctx.organizationId);
  const action = (params.action?.trim().toLowerCase() || "account") as NvoipMcpAction;
  if (!NVOIP_ACTIONS.includes(action)) {
    throw new Error(`Invalid action "${action}". Use: ${NVOIP_ACTIONS.join(", ")}`);
  }

  const account = await loadAccount(ctx.organizationId);

  switch (action) {
    case "account":
      return sanitizeForMcp({
        action,
        account: accountToClientRow(account),
        external: readNvoipExternalConfig(account.externalConfig),
      });

    case "insights": {
      const periodDays = params.periodDays ?? 30;
      const insights = await buildNvoipOrgInsights(ctx.organizationId, periodDays);
      return sanitizeForMcp({ action, periodDays, insights });
    }

    case "logs": {
      const limit = Math.min(params.limit ?? 30, 100);
      const level = params.level?.trim();
      const logs = await prisma.nvoipIntegrationLog.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(level ? { level } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return sanitizeForMcp({
        action,
        count: logs.length,
        logs: logs.map((l) => ({
          id: l.id,
          level: l.level,
          eventType: l.eventType,
          message: l.message,
          createdAt: l.createdAt.toISOString(),
          payload: l.payload,
        })),
      });
    }

    case "trunks": {
      const trunks = await listNvoipTrunks(account.id);
      return sanitizeForMcp({
        action,
        trunks: trunks.map((t) => trunkToClient(t)),
      });
    }

    case "dids": {
      const dids = await nvoipListDids(account);
      return sanitizeForMcp({ action, dids });
    }

    case "balance": {
      const balance = await nvoipGetBalance(account);
      return sanitizeForMcp({ action, balance: balance.balance });
    }

    case "test_connection": {
      const userToken = decryptNvoipSecret(account.userTokenEnc);
      if (!userToken) throw new Error("nvoip_credentials_missing");
      const result = await testNvoipConnection({
        numbersip: account.numbersip,
        userToken,
        napikey: decryptNvoipSecret(account.napikeyEnc),
      });
      return sanitizeForMcp({
        action,
        ok: result.ok,
        balance: result.ok ? result.balance : undefined,
        message: result.ok ? undefined : result.message,
      });
    }

    case "whatsapp": {
      const availability = await getNvoipWhatsappAvailability(ctx.organizationId);
      let templates: unknown[] = [];
      if (availability.available) {
        try {
          templates = await listNvoipWhatsappTemplates(ctx.organizationId);
        } catch {
          templates = [];
        }
      }
      return sanitizeForMcp({ action, availability, templatesCount: templates.length, templates });
    }

    case "sip_users": {
      const users = await listCachedNvoipSipUsers(account.id);
      return sanitizeForMcp({ action, count: users.length, users });
    }

    case "pabx_trunk": {
      const info = maskNvoipTrunkPasswordForClient(await buildNvoipPabxTrunkInfo(account));
      return sanitizeForMcp({ action, pabx: info });
    }

    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

export const nvoipProvider: McpProvider = {
  domain: "nvoip",

  async listResources(ctx): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "nvoip:read");
    try {
      await requireNvoipEnabled(ctx.organizationId);
      const account = await prisma.nvoipAccount.findUnique({ where: { organizationId: ctx.organizationId } });
      if (!account) return [];
      return [
        {
          uri: `opennexo://nvoip/${ctx.organizationId}`,
          name: `Nvoip — ${account.numbersip}`,
          description: `Status: ${account.status}${account.lastError ? ` · ${account.lastError}` : ""}`,
          mimeType: "application/json",
        },
      ];
    } catch {
      return [];
    }
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "nvoip:read");
    return searchNvoip(ctx, { action: "account" });
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "nvoip:read");
    return searchNvoip(ctx, params);
  },
};
