import assert from "node:assert/strict";
import test from "node:test";
import {
  MetaSendError,
  extractFetchErrorDiagnostics,
  formatMetaSendErrorForStorage,
  isMetaNetworkProviderError,
  isOutboundWhatsappDeliveryError,
  validateMetaSendConfig,
} from "./metaSendErrors.js";

test("validateMetaSendConfig rejects missing phoneNumberId", () => {
  assert.throws(() => validateMetaSendConfig("", "token"), (err: unknown) => {
    assert.ok(err instanceof MetaSendError);
    assert.equal(err.kind, "META_CONFIGURATION_ERROR");
    return true;
  });
});

test("validateMetaSendConfig rejects missing accessToken", () => {
  assert.throws(() => validateMetaSendConfig("123456789", ""), (err: unknown) => {
    assert.ok(err instanceof MetaSendError);
    assert.match(err.message, /accessToken missing/);
    return true;
  });
});

test("extractFetchErrorDiagnostics reads undici cause code", () => {
  const cause = Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  const err = new Error("fetch failed", { cause });
  const diag = extractFetchErrorDiagnostics(err);
  assert.equal(diag.causeCode, "UND_ERR_CONNECT_TIMEOUT");
});

test("formatMetaSendErrorForStorage classifies network errors", () => {
  const cause = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  const err = new Error("fetch failed", { cause });
  assert.equal(formatMetaSendErrorForStorage(err), "META_NETWORK_ERROR: ETIMEDOUT");
});

test("isMetaNetworkProviderError matches classified errors", () => {
  assert.equal(isMetaNetworkProviderError("META_NETWORK_ERROR: ETIMEDOUT"), true);
  assert.equal(isMetaNetworkProviderError("fetch failed"), true);
  assert.equal(isMetaNetworkProviderError("META_API_ERROR: HTTP 401"), false);
});

test("isOutboundWhatsappDeliveryError matches META_API_ERROR and legacy strings", () => {
  assert.equal(
    isOutboundWhatsappDeliveryError(
      "META_API_ERROR: HTTP 404 — code 132001 — (#132001) Template name does not exist in the translation",
    ),
    true,
  );
  assert.equal(isOutboundWhatsappDeliveryError("Meta API error: HTTP 404"), true);
  assert.equal(isOutboundWhatsappDeliveryError("Contact not found"), false);
});
