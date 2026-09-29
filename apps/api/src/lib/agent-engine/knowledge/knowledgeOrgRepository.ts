import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db.js";
import { getCachedPlatformSetting } from "../../cachedAutomationAgentProfile.js";
import {
  orgKnowledgeStoreKey,
  parseOrgKnowledgeStore,
} from "./parseKnowledgeEngineConfig.js";
import type { KnowledgeEngineOrgConfig } from "./knowledgeEngineTypes.js";

export type OrgKnowledgeStore = {
  config: KnowledgeEngineOrgConfig;
  updatedAt: string;
};

export async function loadOrgKnowledgeStore(organizationId: string): Promise<OrgKnowledgeStore> {
  const row = await getCachedPlatformSetting(orgKnowledgeStoreKey(organizationId));
  return parseOrgKnowledgeStore(row?.value);
}

export async function saveOrgKnowledgeStore(organizationId: string, store: OrgKnowledgeStore): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: orgKnowledgeStoreKey(organizationId) },
    create: {
      key: orgKnowledgeStoreKey(organizationId),
      value: { ...store, updatedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
    update: {
      value: { ...store, updatedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
  });
}
