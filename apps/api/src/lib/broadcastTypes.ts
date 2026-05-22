import type { BroadcastChannel, BroadcastScheduleType } from "@prisma/client";
import type { FollowUpRecurrence } from "./broadcastRecurrence.js";
import { parseFollowUpRecurrence } from "./broadcastRecurrence.js";

export type { FollowUpRecurrence };

export type { BroadcastChannel, BroadcastScheduleType };

export type BroadcastCampaignKind = "followup" | "broadcast" | "ai" | "flow";

export interface BroadcastSegmentRules {
  tagIds?: string[];
  tagLogic?: "ANY" | "ALL";
  campaignKind?: BroadcastCampaignKind;
  pipelineStageIds?: string[];
  lifecycleStages?: string[];
  cities?: string[];
  optedInOnly?: boolean;
  minDealValue?: number;
  noResponseSinceDays?: number;
  followUpRecurrence?: FollowUpRecurrence;
}

export interface BroadcastAbVariantPayload {
  body?: string;
  templateId?: string;
  subject?: string;
}

export interface BroadcastAbConfig {
  enabled: boolean;
  splitPercentA?: number;
  variantA?: BroadcastAbVariantPayload;
  variantB?: BroadcastAbVariantPayload;
}

export interface BroadcastFlowNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface BroadcastFlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface BroadcastFlowDefinition {
  nodes: BroadcastFlowNode[];
  edges: BroadcastFlowEdge[];
}

export interface BroadcastEventConfig {
  pipelineStageId?: string;
  dealStageId?: string;
  tagId?: string;
}

export const BROADCAST_EVENT_TRIGGERS = [
  "NEW_LEAD",
  "LEAD_IDLE",
  "DEAL_STAGE_CHANGED",
  "DEAL_WON",
  "CHECKOUT_ABANDONED",
  "PAYMENT_OVERDUE",
  "TAG_ADDED",
] as const;

export type BroadcastEventTrigger = (typeof BROADCAST_EVENT_TRIGGERS)[number];

export function segmentHasAudienceFilters(
  tagIds: string[],
  segmentRules: BroadcastSegmentRules | null,
): boolean {
  if (tagIds.length > 0) return true;
  if (!segmentRules) return false;
  return Boolean(
    segmentRules.pipelineStageIds?.length ||
      segmentRules.lifecycleStages?.length ||
      segmentRules.cities?.length ||
      segmentRules.optedInOnly ||
      (segmentRules.minDealValue != null && segmentRules.minDealValue > 0) ||
      (segmentRules.noResponseSinceDays != null && segmentRules.noResponseSinceDays > 0),
  );
}

export function parseSegmentRules(raw: unknown): BroadcastSegmentRules | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    tagIds: Array.isArray(o.tagIds) ? o.tagIds.filter((x): x is string => typeof x === "string") : undefined,
    tagLogic: o.tagLogic === "ALL" ? "ALL" : "ANY",
    pipelineStageIds: Array.isArray(o.pipelineStageIds)
      ? o.pipelineStageIds.filter((x): x is string => typeof x === "string")
      : undefined,
    lifecycleStages: Array.isArray(o.lifecycleStages)
      ? o.lifecycleStages.filter((x): x is string => typeof x === "string")
      : undefined,
    cities: Array.isArray(o.cities) ? o.cities.filter((x): x is string => typeof x === "string") : undefined,
    optedInOnly: o.optedInOnly === true,
    minDealValue: typeof o.minDealValue === "number" ? o.minDealValue : undefined,
    noResponseSinceDays: typeof o.noResponseSinceDays === "number" ? o.noResponseSinceDays : undefined,
    followUpRecurrence: parseFollowUpRecurrence(o) ?? undefined,
    campaignKind:
      o.campaignKind === "followup" ||
      o.campaignKind === "broadcast" ||
      o.campaignKind === "ai" ||
      o.campaignKind === "flow"
        ? o.campaignKind
        : undefined,
  };
}

export function parseAbConfig(raw: unknown): BroadcastAbConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    splitPercentA: typeof o.splitPercentA === "number" ? o.splitPercentA : 50,
    variantA: o.variantA && typeof o.variantA === "object" ? (o.variantA as BroadcastAbVariantPayload) : undefined,
    variantB: o.variantB && typeof o.variantB === "object" ? (o.variantB as BroadcastAbVariantPayload) : undefined,
  };
}

export function parseFlowDefinition(raw: unknown): BroadcastFlowDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return null;
  return { nodes: o.nodes as BroadcastFlowNode[], edges: o.edges as BroadcastFlowEdge[] };
}

export function substituteContactVars(text: string, contact: { name: string; email?: string | null }): string {
  return text
    .replace(/\{\{nome\}\}/gi, contact.name)
    .replace(/\{\{name\}\}/gi, contact.name)
    .replace(/\{\{email\}\}/gi, contact.email ?? "");
}
