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

/** Os INVITEs do mesmo toque chegam com poucos segundos de diferença. */
const SAME_RING_WINDOW_MS = 45_000;

export function sameCallerDigits(left?: string | null, right?: string | null): boolean {
  const a = (left ?? "").replace(/\D/g, "");
  const b = (right ?? "").replace(/\D/g, "");
  if (a.length < 8 || b.length < 8) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return long.endsWith(short);
}

/** Outro usuário atendeu ou encerrou o mesmo toque. A perna local ainda tocando deve sair. */
export function shouldDropSipLegAnsweredElsewhere(input: {
  localUserId: string | null;
  answeredByUserId: string | undefined;
  localDialogId: string | null;
  localCallId?: string | null;
  answeredDialogId: string | undefined;
  localCaller?: string | null;
  answeredCaller?: string | null;
  localStartedAt?: number | null;
  answeredStartedAt?: number | null;
  localStatus: number;
}): boolean {
  const sameCall = !!input.answeredDialogId && sameAnsweredCall(input.localDialogId, input.localCallId, input.answeredDialogId);
  const sameRing =
    sameCallerDigits(input.localCaller, input.answeredCaller) &&
    typeof input.localStartedAt === "number" &&
    typeof input.answeredStartedAt === "number" &&
    Math.abs(input.localStartedAt - input.answeredStartedAt) <= SAME_RING_WINDOW_MS;
  if (!sameCall && !sameRing) return false;
  if (input.localUserId && input.answeredByUserId === input.localUserId) return false;
  if (
    input.localStatus === STATUS_ANSWERED ||
    input.localStatus === STATUS_WAITING_FOR_ACK ||
    input.localStatus === STATUS_CONFIRMED
  ) {
    return false;
  }
  return true;
}

/** O mesmo INVITE chega em cada ramal com o mesmo Call-ID e uma tag From diferente. O id do JsSIP junta os dois. */
function sameAnsweredCall(
  localDialogId: string | null,
  localCallId: string | null | undefined,
  answeredId: string,
): boolean {
  if (localDialogId && localDialogId === answeredId) return true;
  if (localCallId && localCallId === answeredId) return true;
  if (
    localCallId &&
    localCallId.length >= 8 &&
    answeredId.startsWith(localCallId) &&
    answeredId.length > localCallId.length
  ) {
    return true;
  }
  if (
    !localCallId &&
    localDialogId &&
    answeredId.length >= 8 &&
    localDialogId.startsWith(answeredId) &&
    localDialogId.length > answeredId.length
  ) {
    return true;
  }
  return false;
}
