import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAgentLlmCredentialsForMode } from "./AiCredentialResolver.js";
import { normalizeAiBillingMode, isAiBillingMode } from "./aiBillingTypes.js";
import { config } from "../../config.js";

describe("aiBillingTypes", () => {
  it("defaults unknown values to OWN_API_KEY", () => {
    assert.equal(normalizeAiBillingMode(undefined), "OWN_API_KEY");
    assert.equal(normalizeAiBillingMode("invalid"), "OWN_API_KEY");
    assert.equal(isAiBillingMode("PLATFORM_CREDITS"), true);
  });
});

describe("AiCredentialResolver", () => {
  it("OWN_API_KEY preserves profile provider and key resolution order", () => {
    const resolved = resolveAgentLlmCredentialsForMode("OWN_API_KEY", {
      provider: "kimi",
      model: "kimi-k3",
      apiKey: "sk-profile",
      apiBaseUrl: "https://custom.example/v1",
    });

    assert.equal(resolved.billingMode, "OWN_API_KEY");
    assert.equal(resolved.provider, "kimi");
    assert.equal(resolved.model, "kimi-k3");
    assert.equal(resolved.apiKey, "sk-profile");
    assert.equal(resolved.apiBaseUrl, "https://custom.example/v1");
    assert.equal(resolved.keySource, "profile");
  });

  it("OWN_API_KEY falls back to platform env when profile key is empty", () => {
    const previous = config.kimiPromptPreviewKey;
    config.kimiPromptPreviewKey = "sk-kimi-env";
    try {
      const resolved = resolveAgentLlmCredentialsForMode("OWN_API_KEY", {
        provider: "kimi",
        model: "kimi-k3",
        apiKey: "",
      });
      assert.equal(resolved.apiKey, "sk-kimi-env");
      assert.equal(resolved.keySource, "server_kimi_env");
    } finally {
      config.kimiPromptPreviewKey = previous;
    }
  });

  it("PLATFORM_CREDITS uses platform credential and keeps agent model", () => {
    const previousProvider = config.platformCreditsLlmProvider;
    const previousKey = config.openAiPromptPreviewKey;
    const previousUrl = config.openAiApiBaseUrl;
    config.platformCreditsLlmProvider = "openai";
    config.openAiPromptPreviewKey = "sk-platform";
    config.openAiApiBaseUrl = "https://api.openai.com/v1";
    try {
      const resolved = resolveAgentLlmCredentialsForMode("PLATFORM_CREDITS", {
        provider: "anthropic",
        model: "gpt-4o-mini",
        apiKey: "sk-org-should-not-be-used",
        apiBaseUrl: "https://should-not-be-used.example",
      });

      assert.equal(resolved.billingMode, "PLATFORM_CREDITS");
      assert.equal(resolved.provider, "openai");
      assert.equal(resolved.model, "gpt-4o-mini");
      assert.equal(resolved.apiKey, "sk-platform");
      assert.equal(resolved.apiBaseUrl, "https://api.openai.com/v1");
      assert.equal(resolved.keySource, "platform_credits");
    } finally {
      config.platformCreditsLlmProvider = previousProvider;
      config.openAiPromptPreviewKey = previousKey;
      config.openAiApiBaseUrl = previousUrl;
    }
  });
});
