import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMetaErrorCode,
  isMetaFetchFailedError,
  isMetaMarketingFrequencyCapError,
  META_DELIVERY_ERROR_CODES,
} from "./metaDeliveryErrorHints.js";

test("extractMetaErrorCode — formato webhook Meta", () => {
  const code = extractMetaErrorCode(
    "131049 — This message was not delivered to maintain healthy ecosystem engagement. — details",
  );
  assert.equal(code, 131049);
});

test("extractMetaErrorCode — ausente", () => {
  assert.equal(extractMetaErrorCode(null), null);
  assert.equal(extractMetaErrorCode(""), null);
});

test("isMetaFetchFailedError", () => {
  assert.equal(isMetaFetchFailedError("fetch failed"), true);
  assert.equal(isMetaFetchFailedError("Meta API error: 400"), false);
});

test("isMetaMarketingFrequencyCapError", () => {
  assert.equal(isMetaMarketingFrequencyCapError("131049 — cap"), true);
  assert.equal(isMetaMarketingFrequencyCapError("400 — bad request"), false);
  assert.equal(
    isMetaMarketingFrequencyCapError(`x ${META_DELIVERY_ERROR_CODES.MARKETING_FREQUENCY_CAP} y`),
    true,
  );
});
