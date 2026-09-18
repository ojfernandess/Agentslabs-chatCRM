import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_API_ENDPOINT_RATE_LIMIT_CONFIG,
  parseApiEndpointRateLimitConfig,
} from "./apiEndpointRateLimitSettings.js";

test("parseApiEndpointRateLimitConfig uses defaults when empty", () => {
  const config = parseApiEndpointRateLimitConfig(null);
  assert.equal(config.endpoints.send_template.max, 5);
  assert.equal(config.endpoints.send_template.timeWindowSeconds, 1);
  assert.equal(config.endpoints.messages_post.max, 10);
  assert.equal(config.endpoints.templates_list.timeWindowSeconds, 60);
});

test("parseApiEndpointRateLimitConfig merges overrides and clamps values", () => {
  const config = parseApiEndpointRateLimitConfig({
    endpoints: {
      send_template: { enabled: true, max: 99999, timeWindowSeconds: 0, keyBy: "ip" },
      messages_post: { enabled: false, max: 3, timeWindowSeconds: 2, keyBy: "api_token" },
    },
  });
  assert.equal(config.endpoints.send_template.max, 10_000);
  assert.equal(config.endpoints.send_template.timeWindowSeconds, 1);
  assert.equal(config.endpoints.send_template.keyBy, "ip");
  assert.equal(config.endpoints.messages_post.enabled, false);
  assert.equal(config.endpoints.messages_post.max, 3);
  assert.equal(config.endpoints.templates_list.enabled, DEFAULT_API_ENDPOINT_RATE_LIMIT_CONFIG.endpoints.templates_list.enabled);
});
