import assert from "node:assert/strict";
import test from "node:test";
import { sipEndAction } from "./sipCallControls.js";

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
