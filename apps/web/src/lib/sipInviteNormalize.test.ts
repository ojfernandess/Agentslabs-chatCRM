import assert from "node:assert/strict";
import test from "node:test";
import { inviteFault, repairInvite, callerFromInvite } from "./sipInviteNormalize.js";

test("repairInvite retargets a DID request URI to the extension", () => {
  const message = "INVITE sip:551123880408@app.nvoip.com.br SIP/2.0\r\nContent-Length: 0\r\n\r\n";
  const repaired = repairInvite(message, "110937011");
  assert.match(repaired.message, /^INVITE sip:110937011@app\.nvoip\.com\.br SIP\/2\.0/);
  assert.equal(repaired.note, "user");
});

test("repairInvite trims a Via header that only parses without the trailing space", () => {
  const message = [
    "INVITE sip:110937011@app.nvoip.com.br SIP/2.0",
    "Via: SIP/2.0/UDP 1.2.3.4:5060;branch=z9hG4bKabc;rport ",
    "From: <sip:551123880408@app.nvoip.com.br>;tag=abc",
    "To: <sip:110937011@app.nvoip.com.br>",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");
  const repaired = repairInvite(message, "110937011");
  assert.match(repaired.message, /Via: SIP\/2\.0\/UDP 1\.2\.3\.4:5060;branch=z9hG4bKabc;rport\r\n/);
  assert.equal(inviteFault(repaired.message), "");
});

test("repairInvite rewrites a From header JsSIP cannot parse", () => {
  const message = [
    "INVITE sip:110937011@app.nvoip.com.br SIP/2.0",
    "From: Sala, Recepcao <sip:551123880408@app.nvoip.com.br>;tag=abc",
    "To: <sip:110937011@app.nvoip.com.br>",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");
  const repaired = repairInvite(message, "110937011");
  assert.match(repaired.message, /From: <sip:551123880408@app\.nvoip\.com\.br>;tag=abc/);
  assert.match(repaired.note, /From/);
});

test("callerFromInvite uses the asserted number when From is anonymous", () => {
  const message = [
    "INVITE sip:110937011@app.nvoip.com.br SIP/2.0",
    "From: \"Anonymous\" <sip:anonymous@anonymous.invalid>;tag=abc",
    "P-Asserted-Identity: <sip:+5511988776655@app.nvoip.com.br>",
    "Call-ID: call-1",
    "",
    "",
  ].join("\r\n");
  assert.deepEqual(callerFromInvite(message), { number: "+5511988776655", name: "" });
});

test("callerFromInvite reads a phone number shown only in the display name", () => {
  const message = [
    "INVITE sip:110937011@app.nvoip.com.br SIP/2.0",
    "From: \"5511912345678\" <sip:anonymous@anonymous.invalid>;tag=abc",
    "",
    "",
  ].join("\r\n");
  assert.deepEqual(callerFromInvite(message), { number: "5511912345678", name: "" });
});

test("callerFromInvite prefers the customer number over the agent extension", () => {
  const message = [
    "INVITE sip:551123880408@app.nvoip.com.br SIP/2.0",
    "From: \"5511988776655\" <sip:110937011@app.nvoip.com.br>;tag=abc",
    "P-Asserted-Identity: <sip:110937011@app.nvoip.com.br>",
    "",
    "",
  ].join("\r\n");
  assert.deepEqual(callerFromInvite(message, "110937011"), { number: "5511988776655", name: "" });
});

test("callerFromInvite keeps a customer From when the asserted identity is the extension", () => {
  const message = [
    "INVITE sip:110937011@app.nvoip.com.br SIP/2.0",
    "From: <sip:5511988776655@app.nvoip.com.br>;tag=abc",
    "P-Asserted-Identity: <sip:110937011@app.nvoip.com.br>",
    "",
    "",
  ].join("\r\n");
  assert.deepEqual(callerFromInvite(message, "110937011"), { number: "5511988776655", name: "" });
});
