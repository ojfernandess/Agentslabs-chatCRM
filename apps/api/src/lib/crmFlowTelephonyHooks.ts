import type { FastifyBaseLogger } from "fastify";
import { fireCrmFlowTriggers } from "./crmFlowHooks.js";

const MISSED_STATUSES = new Set([
  "MISSED",
  "NOT_ANSWERED",
  "REJECTED",
  "BUSY",
  "FAILED",
  "CANCELLED",
  "NO_ANSWER",
]);

export function fireTelephonyCrmTriggers(params: {
  organizationId: string;
  provider: "nvoip" | "3cx" | "wavoip";
  callLogId: string;
  contactId: string | null;
  conversationId: string | null;
  status: string;
  direction: "INCOMING" | "OUTGOING";
  phone: string;
  log?: FastifyBaseLogger;
  isIncomingRing?: boolean;
  isOutboundStart?: boolean;
  isTerminal?: boolean;
}): void {
  const {
    organizationId,
    provider,
    callLogId,
    contactId,
    conversationId,
    status,
    direction,
    phone,
    log,
    isIncomingRing,
    isOutboundStart,
    isTerminal,
  } = params;

  const payload = {
    callLogId,
    contactId,
    conversationId,
    provider,
    status,
    direction,
    phone,
  };

  if (isIncomingRing || (direction === "INCOMING" && status === "RINGING")) {
    fireCrmFlowTriggers(organizationId, "call_inbound", payload, log);
  }
  if (isOutboundStart || (direction === "OUTGOING" && ["DIALING", "ACTIVE", "CALLING"].includes(status))) {
    if (isOutboundStart) {
      fireCrmFlowTriggers(organizationId, "call_outbound", payload, log);
    }
  }
  if (isTerminal) {
    fireCrmFlowTriggers(organizationId, "call_ended", payload, log);
    if (MISSED_STATUSES.has(status.toUpperCase())) {
      fireCrmFlowTriggers(organizationId, "call_missed", payload, log);
    }
  }
}
