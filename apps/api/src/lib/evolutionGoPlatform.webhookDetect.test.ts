import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isEvolutionApiWebhookPayload,
  isEvolutionGoWebhookPayload,
} from "./evolutionGoPlatform.js";

describe("Evolution webhook payload detection", () => {
  it("classifies Evolution API MESSAGES_UPSERT (not Go)", () => {
    const body = {
      event: "MESSAGES_UPSERT",
      instance: "auda-prod",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "ABC" },
        message: { conversation: "ola" },
        messageType: "conversation",
      },
    };
    assert.equal(isEvolutionApiWebhookPayload(body), true);
    assert.equal(isEvolutionGoWebhookPayload(body), false);
  });

  it("classifies messages.upsert dotted form as Evolution API", () => {
    const body = {
      event: "messages.upsert",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "ABC" },
        message: { conversation: "oi" },
      },
    };
    assert.equal(isEvolutionApiWebhookPayload(body), true);
    assert.equal(isEvolutionGoWebhookPayload(body), false);
  });

  it("classifies Evolution Go Message + Info as Go", () => {
    const body = {
      event: "Message",
      instanceId: "inst-1",
      instanceToken: "tok-1",
      data: {
        Info: { Chat: "5511999999999@s.whatsapp.net", IsFromMe: false, ID: "XYZ" },
        Message: { conversation: "ola" },
      },
    };
    assert.equal(isEvolutionApiWebhookPayload(body), false);
    assert.equal(isEvolutionGoWebhookPayload(body), true);
  });

  it("does not treat bare data.key as Go without API event", () => {
    const ambiguous = {
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "ABC" },
        message: { conversation: "ola" },
      },
    };
    assert.equal(isEvolutionGoWebhookPayload(ambiguous), false);
  });
});
