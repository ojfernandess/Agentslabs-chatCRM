import { prisma } from "../../db.js";
import { buildPublicConversationTranscript } from "../agentAssistLlm.js";
import { isOrganizationFeatureEnabled } from "../featureFlags.js";
import { runIntelligentTaggingGraph, type IntelligentTaggingGraphDeps } from "./graph.js";
import { loadTaggingMem0Context } from "./mem0Feedback.js";
import { buildMetadataSummary } from "./nodes/helpers.js";
import {
  DEFAULT_MAX_TAGS,
  DEFAULT_MIN_CONFIDENCE,
  INTELLIGENT_TAGGING_TRIGGERS,
  parseIntelligentTaggingTrigger,
  type IntelligentTaggingGraphState,
  type IntelligentTaggingTrigger,
} from "./types.js";

const DURING_CONVERSATION_COOLDOWN_MS = 90_000;
const duringConversationLastRun = new Map<string, number>();

export type IntelligentTaggingConfig = {
  enabled: boolean;
  minConfidence: number;
  maxTags: number;
  trigger: IntelligentTaggingTrigger;
  privacyAccepted: boolean;
};

export async function loadIntelligentTaggingConfig(
  organizationId: string,
): Promise<IntelligentTaggingConfig> {
  const [settings, featureEnabled] = await Promise.all([
    prisma.settings.findUnique({
      where: { organizationId },
      select: {
        intelligentTaggingEnabled: true,
        intelligentTaggingMinConfidence: true,
        intelligentTaggingMaxTags: true,
        intelligentTaggingTrigger: true,
        assistantAiEnabled: true,
      },
    }),
    isOrganizationFeatureEnabled(organizationId, "intelligent_tagging"),
  ]);

  const orgEnabled = settings?.intelligentTaggingEnabled ?? false;
  const aiPrivacyOk = settings?.assistantAiEnabled !== false;
  const trigger = parseIntelligentTaggingTrigger(settings?.intelligentTaggingTrigger);

  return {
    enabled: orgEnabled && featureEnabled && aiPrivacyOk,
    minConfidence: settings?.intelligentTaggingMinConfidence ?? DEFAULT_MIN_CONFIDENCE,
    maxTags: settings?.intelligentTaggingMaxTags ?? DEFAULT_MAX_TAGS,
    trigger,
    privacyAccepted: orgEnabled && featureEnabled && aiPrivacyOk,
  };
}

export async function shouldRunIntelligentTagging(
  organizationId: string,
  trigger: IntelligentTaggingTrigger,
): Promise<boolean> {
  const config = await loadIntelligentTaggingConfig(organizationId);
  if (!config.enabled) return false;
  if (trigger === "manual") return true;
  return config.trigger === trigger;
}

async function buildGraphState(input: {
  organizationId: string;
  conversationId: string;
  trigger: IntelligentTaggingTrigger;
  initiatedByUserId?: string;
  language?: string;
}): Promise<IntelligentTaggingGraphState | { error: string }> {
  const config = await loadIntelligentTaggingConfig(input.organizationId);
  if (!config.enabled) {
    return { error: "intelligent_tagging_disabled" };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      priority: true,
      contactId: true,
      contact: {
        select: {
          name: true,
          tags: { select: { tag: { select: { name: true } } } },
          pipelineStage: { select: { name: true } },
        },
      },
      inbox: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          direction: true,
          body: true,
          isPrivate: true,
          mediaUrl: true,
          type: true,
        },
      },
    },
  });

  if (!conversation) {
    return { error: "conversation_not_found" };
  }

  const [tagCatalog, mem0Context] = await Promise.all([
    prisma.tag.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
    loadTaggingMem0Context(input.organizationId, conversation.contactId),
  ]);

  const attachmentCount = conversation.messages.filter((m) => Boolean(m.mediaUrl)).length;
  const transcript = buildPublicConversationTranscript(conversation.messages, 80);
  if (attachmentCount > 0 && transcript.trim()) {
    // Metadado leve sobre anexos (conteúdo binário não é enviado ao modelo).
  }

  return {
    organizationId: input.organizationId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
    contactName: conversation.contact.name ?? "",
    trigger: input.trigger,
    initiatedByUserId: input.initiatedByUserId,
    minConfidence: config.minConfidence,
    maxTags: config.maxTags,
    language: input.language ?? "pt",
    privacyAccepted: config.privacyAccepted,
    tagCatalog,
    existingTagNames: conversation.contact.tags.map((t) => t.tag.name),
    transcript,
    metadataSummary: buildMetadataSummary({
      status: conversation.status,
      priority: conversation.priority,
      inboxName: conversation.inbox?.name,
      pipelineStage: conversation.contact.pipelineStage?.name ?? null,
      attachmentCount,
    }),
    mem0Context,
    classifications: [],
    suggestedNewTags: [],
    autoApply: [],
    pendingReview: [],
    autoAppliedTagIds: [],
    startedAtMs: Date.now(),
  };
}

export async function runIntelligentTagging(
  input: {
    organizationId: string;
    conversationId: string;
    trigger: IntelligentTaggingTrigger;
    initiatedByUserId?: string;
    language?: string;
  },
  deps: IntelligentTaggingGraphDeps = {},
): Promise<
  | { ok: true; runId: string; autoAppliedTagIds: string[]; pendingReviewCount: number; error?: string }
  | { ok: false; error: string; skipped?: boolean }
> {
  const allowed = await shouldRunIntelligentTagging(input.organizationId, input.trigger);
  if (!allowed) {
    return { ok: false, error: "intelligent_tagging_disabled", skipped: true };
  }

  const built = await buildGraphState(input);
  if ("error" in built && !("organizationId" in built)) {
    return { ok: false, error: built.error };
  }

  const finalState = await runIntelligentTaggingGraph(built, deps);
  if (!finalState.runId) {
    return { ok: false, error: finalState.error ?? "run_failed" };
  }

  return {
    ok: true,
    runId: finalState.runId,
    autoAppliedTagIds: finalState.autoAppliedTagIds,
    pendingReviewCount: finalState.pendingReview.length,
    error: finalState.error,
  };
}

/** Disparo assíncrono ao resolver conversa (não bloqueia o pedido HTTP). */
export function scheduleIntelligentTaggingOnResolve(
  input: { organizationId: string; conversationId: string; initiatedByUserId?: string },
  log?: { warn: (obj: unknown, msg: string) => void },
): void {
  void (async () => {
    try {
      const config = await loadIntelligentTaggingConfig(input.organizationId);
      if (!config.enabled || config.trigger !== "on_resolve") return;
      await runIntelligentTagging({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        trigger: "on_resolve",
        initiatedByUserId: input.initiatedByUserId,
      });
    } catch (err) {
      log?.warn({ err, conversationId: input.conversationId }, "intelligent tagging on resolve failed");
    }
  })();
}

/** Disparo assíncrono após mensagem inbound (modo during_conversation). */
export function scheduleIntelligentTaggingDuringConversation(
  input: { organizationId: string; conversationId: string },
  log?: { warn: (obj: unknown, msg: string) => void },
): void {
  const debounceKey = `${input.organizationId}:${input.conversationId}`;
  const now = Date.now();
  const lastRun = duringConversationLastRun.get(debounceKey) ?? 0;
  if (now - lastRun < DURING_CONVERSATION_COOLDOWN_MS) return;
  duringConversationLastRun.set(debounceKey, now);

  void (async () => {
    try {
      const config = await loadIntelligentTaggingConfig(input.organizationId);
      if (!config.enabled || config.trigger !== "during_conversation") return;

      const conversation = await prisma.conversation.findFirst({
        where: { id: input.conversationId, organizationId: input.organizationId },
        select: { id: true, status: true },
      });
      if (!conversation || conversation.status === "RESOLVED") return;

      await runIntelligentTagging({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        trigger: "during_conversation",
      });
    } catch (err) {
      log?.warn(
        { err, conversationId: input.conversationId },
        "intelligent tagging during conversation failed",
      );
    }
  })();
}

export { INTELLIGENT_TAGGING_TRIGGERS };
