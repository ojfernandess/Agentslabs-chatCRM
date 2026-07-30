/**
 * Qualidade da reply ao contacto — reexporta o modulo do agent-engine
 * para manter imports legados (`../../agentReplyQuality.js`).
 */
export {
  isLikelyStallOnlyReply,
  isToolNarrationReply,
  hasSubstantiveAgentReplyToCustomer,
  isNonDeliveringAgentReply,
  buildRuntimeOwnedReplyGuardAppendix,
} from "./agent-engine/reply/ReplyQuality.js";
