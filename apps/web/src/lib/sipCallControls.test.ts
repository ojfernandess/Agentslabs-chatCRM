import assert from "node:assert/strict";
import test from "node:test";
import { shouldDropSipLegAnsweredElsewhere, shouldQueueIncomingCall, sipEndAction, sipSessionOccupiesLine } from "./sipCallControls.js";

const session = (patch: {
  ended?: boolean;
  established?: boolean;
  direction?: string;
  status: number;
}) => ({
  isEnded: () => patch.ended === true,
  isEstablished: () => patch.established === true,
  direction: patch.direction,
  status: patch.status,
});

test("sipEndAction rejects an unanswered incoming call and cancels an outbound attempt", () => {
  assert.equal(sipEndAction(session({ direction: "incoming", status: 4 })), "reject");
  assert.equal(sipEndAction(session({ direction: "outgoing", status: 1 })), "cancel");
});

test("sipEndAction sends BYE only after the dialog can accept it", () => {
  assert.equal(sipEndAction(session({ direction: "incoming", established: true, status: 5 })), "reject");
  assert.equal(sipEndAction(session({ direction: "incoming", established: true, status: 6 })), "bye");
  assert.equal(sipEndAction(session({ direction: "incoming", established: true, status: 9 })), "bye");
});

test("sipEndAction ignores a session that already ended", () => {
  assert.equal(sipEndAction(session({ ended: true, status: 8 })), "ignore");
});

test("shouldDropSipLegAnsweredElsewhere clears only the other agents still ringing", () => {
  const base = {
    localUserId: "agent-b",
    answeredByUserId: "agent-a",
    localDialogId: "call-1",
    answeredDialogId: "call-1",
    localStatus: 4,
  };
  assert.equal(shouldDropSipLegAnsweredElsewhere(base), true);
  assert.equal(shouldDropSipLegAnsweredElsewhere({ ...base, answeredByUserId: "agent-b", localUserId: "agent-b" }), false);
  assert.equal(shouldDropSipLegAnsweredElsewhere({ ...base, localDialogId: "call-2" }), false);
  assert.equal(shouldDropSipLegAnsweredElsewhere({ ...base, localStatus: 9 }), false);
  assert.equal(shouldDropSipLegAnsweredElsewhere({ ...base, localStatus: 5 }), false);
});

test("shouldDropSipLegAnsweredElsewhere matches another fork by Call-ID", () => {
  const callId = "abc1234567890def";
  assert.equal(
    shouldDropSipLegAnsweredElsewhere({
      localUserId: "agent-b",
      answeredByUserId: "agent-a",
      localDialogId: `${callId}tag-b`,
      localCallId: callId,
      answeredDialogId: callId,
      localStatus: 4,
    }),
    true,
  );
  assert.equal(
    shouldDropSipLegAnsweredElsewhere({
      localUserId: "agent-b",
      answeredByUserId: "agent-a",
      localDialogId: `${callId}tag-b`,
      localCallId: callId,
      answeredDialogId: `${callId}tag-a`,
      localStatus: 4,
    }),
    true,
  );
  assert.equal(
    shouldDropSipLegAnsweredElsewhere({
      localUserId: "agent-b",
      answeredByUserId: "agent-a",
      localDialogId: "zzzzzzzzzzzzzzzz",
      localCallId: "zzzzzzzzzzzzzzzz",
      answeredDialogId: callId,
      localStatus: 4,
    }),
    false,
  );
});

test("shouldQueueIncomingCall keeps the live session and lines the next call up", () => {
  assert.equal(shouldQueueIncomingCall(null), false);
  assert.equal(shouldQueueIncomingCall(session({ status: 8 })), false);
  assert.equal(shouldQueueIncomingCall(session({ status: 4, direction: "incoming" })), true);
  assert.equal(shouldQueueIncomingCall(session({ status: 9, established: true })), true);
});

test("sipSessionOccupiesLine keeps a live call and frees a finished one", () => {
  assert.equal(sipSessionOccupiesLine(session({ status: 3 })), true);
  assert.equal(sipSessionOccupiesLine(session({ status: 9, established: true })), true);
  assert.equal(sipSessionOccupiesLine(session({ status: 8 })), false);
  assert.equal(sipSessionOccupiesLine(session({ status: 9, ended: true })), false);
});
