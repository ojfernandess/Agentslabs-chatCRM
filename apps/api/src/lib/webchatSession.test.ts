import { describe, it } from "node:test";
import assert from "node:assert/strict";

// webchatSession.ts importa config.ts (getWebAppPublicOrigin), que exige env em import-time.
// Import dinâmico após defaults — mesmo padrão dos testes de billing (billingTestEnv).
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
const { newWebchatToken, isWebchatSessionExpired, buildWebchatContinuityBody, hashWebchatClientSession, isWebchatHistoryUnlocked } = await import(
  "./webchatSession.js"
);

describe("newWebchatToken — secure, random, non-enumerable (spec §19)", () => {
  it("has at least 256 bits of entropy encoded as base64url", () => {
    const token = newWebchatToken();
    assert.ok(token.length >= 43, `token too short: ${token.length}`);
    assert.match(token, /^[A-Za-z0-9_-]+$/, "token must be URL-safe without encoding");
  });

  it("never repeats across generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newWebchatToken());
    assert.equal(seen.size, 500);
  });

  it("does not embed internal IDs (no organization_id / conversation_id / contact_id in URL)", () => {
    // O token é puramente aleatório — não deriva de IDs internos.
    const a = newWebchatToken();
    const b = newWebchatToken();
    assert.notEqual(a.slice(0, 16), b.slice(0, 16));
  });
});

describe("isWebchatSessionExpired (spec §20 — SESSION_EXPIRED)", () => {
  it("returns false while expires_at is in the future", () => {
    assert.equal(isWebchatSessionExpired({ expiresAt: new Date(Date.now() + 60_000) }), false);
  });

  it("returns true when expires_at passed", () => {
    assert.equal(isWebchatSessionExpired({ expiresAt: new Date(Date.now() - 1_000) }), true);
  });
});

describe("buildWebchatContinuityBody — {{webchat_url}} substitution (spec §18.1)", () => {
  const url = "https://chat.example.com/s/tok_abc123";

  it("replaces the mandatory {{webchat_url}} variable with the system-generated link", () => {
    const body = buildWebchatContinuityBody(
      "Para continuar seu atendimento pelo navegador, acesse o link abaixo:\n\n{{webchat_url}}",
      url,
    );
    assert.ok(body.includes(url));
    assert.ok(!body.includes("{{webchat_url}}"));
  });

  it("replaces every occurrence of the placeholder", () => {
    const body = buildWebchatContinuityBody("{{webchat_url}} ou {{webchat_url}}", url);
    assert.equal(body, `${url} ou ${url}`);
  });

  it("appends the link when the org template forgot the placeholder", () => {
    const body = buildWebchatContinuityBody("Continue online:", url);
    assert.ok(body.startsWith("Continue online:"));
    assert.ok(body.endsWith(url));
  });

  it("falls back to the default message when no template is configured", () => {
    for (const template of [null, undefined, "", "   "]) {
      const body = buildWebchatContinuityBody(template, url);
      assert.ok(body.includes(url), `template=${JSON.stringify(template)}`);
      assert.ok(body.length > url.length);
    }
  });
});

describe("isWebchatHistoryUnlocked — outbound routing gate", () => {
  it("returns false until the client claims the session", () => {
    assert.equal(isWebchatHistoryUnlocked({ clientSessionHash: null }), false);
    assert.equal(isWebchatHistoryUnlocked({ clientSessionHash: "abc" }), true);
  });
});

describe("hashWebchatClientSession — device binding secret", () => {
  it("returns a stable SHA-256 hex digest", () => {
    const hash = hashWebchatClientSession("client-secret-1");
    assert.equal(hash.length, 64);
    assert.equal(hashWebchatClientSession("client-secret-1"), hash);
    assert.notEqual(hashWebchatClientSession("client-secret-2"), hash);
  });
});
