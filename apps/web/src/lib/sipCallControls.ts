/** Estado público do JsSIP. ANSWERED ainda rejeita; ACK pendente e confirmada enviam BYE. */
const STATUS_ANSWERED = 5;
const STATUS_WAITING_FOR_ACK = 6;
const STATUS_CONFIRMED = 9;

export type SipEndAction = "ignore" | "reject" | "cancel" | "bye";

export function sipEndAction(session: {
  isEnded: () => boolean;
  isEstablished: () => boolean;
  direction?: string;
  status: number;
}): SipEndAction {
  if (session.isEnded()) return "ignore";
  if (session.status === STATUS_WAITING_FOR_ACK || session.status === STATUS_CONFIRMED) return "bye";
  if (session.isEstablished() && session.status !== STATUS_ANSWERED) return "bye";
  if (session.direction === "incoming") return "reject";
  return "cancel";
}
