/** Estado público do JsSIP. ANSWERED ainda rejeita; ACK pendente e confirmada enviam BYE. */
const STATUS_ANSWERED = 5;
const STATUS_WAITING_FOR_ACK = 6;
const STATUS_CONFIRMED = 9;

const LIVE_STATUSES = new Set([1, 2, 3, 4, 5, 6, 9]);

export type SipEndAction = "ignore" | "reject" | "cancel" | "bye";

/** Há uma sessão viva. A próxima chamada recebida entra na fila em vez de ocupar o lugar dela. */
export function sipSessionOccupiesLine(session: { isEnded: () => boolean; status: number }): boolean {
  if (session.isEnded()) return false;
  return LIVE_STATUSES.has(session.status);
}

export function shouldQueueIncomingCall(
  current: { isEnded: () => boolean; status: number } | null,
): boolean {
  return !!current && sipSessionOccupiesLine(current);
}

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

/** Outro usuário atendeu o mesmo INVITE. A perna local ainda tocando deve sair. */
export function shouldDropSipLegAnsweredElsewhere(input: {
  localUserId: string | null;
  answeredByUserId: string | undefined;
  localDialogId: string | null;
  answeredDialogId: string | undefined;
  localStatus: number;
}): boolean {
  if (!input.answeredDialogId || input.answeredDialogId !== input.localDialogId) return false;
  if (input.localUserId && input.answeredByUserId === input.localUserId) return false;
  if (input.localStatus === STATUS_WAITING_FOR_ACK || input.localStatus === STATUS_CONFIRMED) return false;
  return true;
}
