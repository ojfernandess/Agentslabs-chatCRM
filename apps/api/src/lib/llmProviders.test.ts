import assert from "node:assert/strict";
import test from "node:test";
import { resolveLlmApiBaseUrl, resolvePlatformLlmApiKey } from "./llmProviders.js";

const keys = {
  openAiPromptPreviewKey: "sk-openai",
  geminiPromptPreviewKey: "gem-gemini",
  kimiPromptPreviewKey: "sk-kimi",
  xaiPromptPreviewKey: "sk-xai",
  anthropicPromptPreviewKey: "sk-anthropic",
};

const urls = {
  openAiApiBaseUrl: "https://api.openai.com/v1",
  kimiApiBaseUrl: "https://api.moonshot.ai/v1",
  xaiApiBaseUrl: "https://api.x.ai/v1",
  anthropicApiBaseUrl: "https://api.anthropic.com",
};

test("resolvePlatformLlmApiKey prefers stored key", () => {
  assert.equal(resolvePlatformLlmApiKey("kimi", "sk-profile", keys), "sk-profile");
});

test("resolvePlatformLlmApiKey falls back to kimi env", () => {
  assert.equal(resolvePlatformLlmApiKey("kimi", "", keys), "sk-kimi");
});

test("resolveLlmApiBaseUrl defaults kimi to moonshot endpoint", () => {
  assert.equal(resolveLlmApiBaseUrl("kimi", "", urls), "https://api.moonshot.ai/v1");
});

test("resolveLlmApiBaseUrl keeps stored url", () => {
  assert.equal(resolveLlmApiBaseUrl("kimi", "https://custom.example/v1/", urls), "https://custom.example/v1");
});

test("resolvePlatformLlmApiKey falls back to xai env", () => {
  assert.equal(resolvePlatformLlmApiKey("xai", "", keys), "sk-xai");
});

test("resolveLlmApiBaseUrl defaults xai to x.ai endpoint", () => {
  assert.equal(resolveLlmApiBaseUrl("xai", "", urls), "https://api.x.ai/v1");
});

test("resolvePlatformLlmApiKey falls back to anthropic env", () => {
  assert.equal(resolvePlatformLlmApiKey("anthropic", "", keys), "sk-anthropic");
});

test("resolveLlmApiBaseUrl defaults anthropic to anthropic endpoint", () => {
  assert.equal(resolveLlmApiBaseUrl("anthropic", "", urls), "https://api.anthropic.com");
});
