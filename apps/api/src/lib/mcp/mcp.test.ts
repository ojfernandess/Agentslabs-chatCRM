import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_ROLE_PERMISSIONS,
  hasPermission,
  requirePermission,
  McpForbiddenError,
} from "./access/permissions.js";
import { sanitizeForMcp, llmConfigSafeSummary } from "./security/sanitize.js";
import { MCP_TOKEN_PREFIX, generateMcpTokenParts } from "./auth/mcpTokenService.js";

describe("MCP permissions", () => {
  it("admin has debug permissions", () => {
    const perms = new Set(MCP_ROLE_PERMISSIONS.admin);
    assert.ok(hasPermission({ permissions: perms }, "agents:debug"));
    assert.ok(hasPermission({ permissions: perms }, "audit:read"));
  });

  it("read_only lacks debug permissions", () => {
    const perms = new Set(MCP_ROLE_PERMISSIONS.read_only);
    assert.ok(!hasPermission({ permissions: perms }, "agents:debug"));
    assert.ok(hasPermission({ permissions: perms }, "agents:read"));
  });

  it("requirePermission throws McpForbiddenError", () => {
    const perms = new Set(MCP_ROLE_PERMISSIONS.read_only);
    assert.throws(
      () => requirePermission({ permissions: perms }, "agents:debug"),
      McpForbiddenError,
    );
  });
});

describe("MCP sanitize", () => {
  it("redacts apiKey and tokens", () => {
    const out = sanitizeForMcp({
      name: "test",
      apiKey: "sk-secret",
      nested: { webhookSecret: "whsec_abc" },
    }) as Record<string, unknown>;
    assert.equal(out.apiKey, "[REDACTED]");
    assert.deepEqual(out.nested, { webhookSecret: "[REDACTED]" });
  });

  it("llmConfigSafeSummary hides key value", () => {
    const summary = llmConfigSafeSummary({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
    }) as Record<string, unknown>;
    assert.equal(summary.hasLlmKey, true);
    assert.equal(summary.apiKey, undefined);
  });
});

describe("MCP token service", () => {
  it("generates ocm_ prefixed tokens", () => {
    const { token, prefix } = generateMcpTokenParts();
    assert.ok(token.startsWith(MCP_TOKEN_PREFIX));
    assert.equal(prefix, token.slice(0, 12));
  });
});

describe("MCP provider registry URI", () => {
  it("parses opennexo URIs", async () => {
    const { parseMcpUri } = await import("./providers/ProviderRegistry.js");
    const parsed = parseMcpUri("opennexo://agents/550e8400-e29b-41d4-a716-446655440000");
    assert.equal(parsed?.domain, "agents");
    assert.ok(parsed?.id.startsWith("550e8400"));
  });
});
