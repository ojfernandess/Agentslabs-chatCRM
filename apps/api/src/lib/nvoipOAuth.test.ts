import assert from "node:assert/strict";
import { test } from "node:test";
import { nvoipEncodeClientCredentialsBasic, nvoipQuotePlus } from "./nvoipClient.js";

test("nvoip v3 basic auth matches quote_plus client_id:client_secret", () => {
  const clientId = "client: &+á";
  const clientSecret = "dummy: &+é";
  const decoded = Buffer.from(
    nvoipEncodeClientCredentialsBasic(clientId, clientSecret),
    "base64",
  ).toString("utf8");
  assert.equal(decoded, `${nvoipQuotePlus(clientId)}:${nvoipQuotePlus(clientSecret)}`);
  assert.match(decoded, /client%3A\+%26%2B/);
  assert.doesNotMatch(decoded, / /);
});
