import crypto from "node:crypto";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import type { ConversationInsightPayload } from "./agentAssistLlm.js";
import { assertHttpUrlAllowed } from "./httpToolTest.js";
import { secureHttpFetch } from "./secureHttpFetch.js";

/**
 * Dispatches a webhook notification when AI detects alerts or negative sentiment in a conversation.
 * Triggered after POST /conversations/:id/insights.
 */
export async function dispatchAiAlertWebhook(
  organizationId: string,
  conversationId: string,
  insights: ConversationInsightPayload,
) {
  // Only dispatch if there are alerts or negative sentiment
  const hasAlerts = insights.alerts.length > 0;
  const isNegative = insights.sentiment === "negative" || insights.sentiment === "frustrated";

  if (!hasAlerts && !isNegative) return;

  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { aiAlertWebhookUrl: true, aiAlertWebhookSecret: true },
  });

  if (!settings?.aiAlertWebhookUrl) return;

  const payload = {
    event: "ai.alert",
    timestamp: new Date().toISOString(),
    organizationId,
    conversationId,
    insights,
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenConduit-AI-Alerts/1.0",
  };

  if (settings.aiAlertWebhookSecret) {
    const secret = decrypt(settings.aiAlertWebhookSecret);
    if (secret) {
      const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
      headers["X-OpenConduit-Signature"] = signature;
    }
  }

  try {
    assertHttpUrlAllowed(settings.aiAlertWebhookUrl);
    const res = await secureHttpFetch(settings.aiAlertWebhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    
    if (!res.ok) {
      console.warn(`[AI-Webhook] Failed for org ${organizationId}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[AI-Webhook] Error for org ${organizationId}:`, err);
  }
}
