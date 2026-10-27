import assert from "node:assert/strict";
import test from "node:test";
import { phoneMatchSuffix, phonesLooselyMatch } from "./contactPhoneMatch.js";

test("phonesLooselyMatch treats plus, spaces and country code as the same number", () => {
  assert.equal(phonesLooselyMatch("+5511999990000", "5511999990000"), true);
  assert.equal(phonesLooselyMatch("+5511999990000", "+55 11 99999-0000"), true);
  assert.equal(phonesLooselyMatch("+5511999990000", "11 99999-0000"), true);
});

test("phonesLooselyMatch treats Brazilian mobile with or without the extra 9 as the same number", () => {
  assert.equal(phonesLooselyMatch("+5511999990000", "+551199990000"), true);
  assert.equal(phonesLooselyMatch("5511999990000", "1199990000"), true);
});

test("phonesLooselyMatch does not merge unrelated numbers", () => {
  assert.equal(phonesLooselyMatch("+5511999990000", "+5511888880000"), false);
  assert.equal(phonesLooselyMatch("+5511999990000", "+14155552671"), false);
});

test("phoneMatchSuffix still returns the national 10–11 digits", () => {
  assert.equal(phoneMatchSuffix("+5511999990000"), "11999990000");
  assert.equal(phoneMatchSuffix("11999990000"), "11999990000");
});
