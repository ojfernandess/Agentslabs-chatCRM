import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhoneE164 } from "@openconduit/shared";
import { normalizeContactPhone } from "./contactPhone.js";

test("normalizeContactPhone accepts spaced Brazilian mobile +55 11 94802-7351", () => {
  assert.equal(normalizeContactPhone("+55 11 94802-7351"), "+5511948027351");
  assert.equal(normalizeContactPhone("+55 (11) 94802-7351"), "+5511948027351");
  assert.equal(normalizeContactPhone("55 11 94802-7351"), "+5511948027351");
  assert.equal(normalizeContactPhone("(11) 94802-7351"), "+5511948027351");
  assert.equal(normalizeContactPhone("11 94802-7351"), "+5511948027351");
  assert.equal(normalizeContactPhone("011 94802-7351"), "+5511948027351");
  assert.equal(normalizeContactPhone("(11) 3333-4444"), "+551133334444");
});

test("normalizeContactPhone keeps already canonical E.164", () => {
  assert.equal(normalizeContactPhone("+5511948027351"), "+5511948027351");
  assert.equal(normalizeContactPhone("+14155552671"), normalizePhoneE164("+1 415 555 2671"));
  assert.equal(normalizeContactPhone("+1 415 555 2671"), "+14155552671");
});

test("normalizeContactPhone keeps foreign numbers on the existing E.164 path", () => {
  const foreign = [
    "+1 415 555 2671",
    "+1 (415) 555-2671",
    "+44 20 7946 0958",
    "+44 (0) 20 7946 0958",
    "+351 912 345 678",
    "+351 21 394 8000",
    "+54 11 4321-5678",
    "+54 9 11 1234-5678",
    "+49 151 23456789",
    "+33 6 12 34 56 78",
    "+34 612 34 56 78",
    "+81 90-1234-5678",
    "14155552671",
    "442079460958",
    "351912345678",
    "541143215678",
    "4155552671",
  ];
  for (const raw of foreign) {
    assert.equal(normalizeContactPhone(raw), normalizePhoneE164(raw), raw);
  }
  assert.equal(normalizeContactPhone("0044 20 7946 0958"), "+442079460958");
  assert.equal(normalizeContactPhone("001 415 555 2671"), "+14155552671");
});

test("normalizeContactPhone rejects values that are not a phone", () => {
  assert.equal(normalizeContactPhone(""), null);
  assert.equal(normalizeContactPhone("abc"), null);
  assert.equal(normalizeContactPhone("123"), null);
});
