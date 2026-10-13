import assert from "node:assert/strict";
import test from "node:test";
import { sipClock, sipFrames, sipKeepaliveAction } from "./sipDiagnostics.js";

const options =
  "OPTIONS sip:0001@app.nvoip.com.br SIP/2.0\r\nVia: SIP/2.0/WSS app.nvoip.com.br\r\nContent-Length: 0\r\n\r\n";

test("sipClock uses the local hour", () => {
  assert.equal(sipClock(new Date(2026, 9, 7, 9, 57, 18)), "09:57:18");
});

test("sipFrames keeps a complete OPTIONS message", () => {
  assert.deepEqual(sipFrames(options), [options]);
});

test("sipFrames drops a leading keepalive stuck to an INVITE", () => {
  const invite = "INVITE sip:0001@app.nvoip.com.br SIP/2.0\r\nContent-Length: 0\r\n\r\n";
  assert.deepEqual(sipFrames(`\r\n\r\n${invite}`), [invite]);
});

test("sipFrames strips a leading line feed before a CRLF INVITE", () => {
  const invite = "INVITE sip:0001@app.nvoip.com.br SIP/2.0\r\nContent-Length: 0\r\n\r\n";
  assert.deepEqual(sipFrames(`\n${invite}`), [invite]);
});

test("sipFrames turns LF-only messages into CRLF", () => {
  const raw = "INVITE sip:0001@app.nvoip.com.br SIP/2.0\nContent-Length: 0\n\n";
  const frame = sipFrames(raw)[0] ?? "";
  assert.equal(frame.includes("\r\n"), true);
  assert.equal(frame.startsWith("INVITE "), true);
});

test("sipKeepaliveAction keeps a bare ping for JsSIP", () => {
  assert.equal(sipKeepaliveAction("\r\n\r\n"), "forward");
  assert.equal(sipKeepaliveAction("\r\n"), "forward");
});

test("sipKeepaliveAction answers a ping glued to a SIP message", () => {
  const invite = "INVITE sip:0001@app.nvoip.com.br SIP/2.0\r\nContent-Length: 0\r\n\r\n";
  assert.equal(sipKeepaliveAction(`\r\n\r\n${invite}`), "pong");
  assert.equal(sipKeepaliveAction(invite), "none");
});

test("sipFrames splits two messages in one websocket frame", () => {
  const invite = "INVITE sip:0001@app.nvoip.com.br SIP/2.0\r\nContent-Length: 3\r\n\r\nv=0";
  assert.deepEqual(sipFrames(options + invite), [options, invite]);
});
