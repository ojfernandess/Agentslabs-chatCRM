import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentVoiceSettings, shouldSendVoiceReply } from "./agentVoiceSettings.js";

test("parseAgentVoiceSettings reads nested voice block", () => {
  const s = parseAgentVoiceSettings({
    voice: {
      elevenLabsEnabled: true,
      elevenLabsToolId: "tool-1",
      voiceResponsePercent: 50,
      replyWithAudioOnInboundAudio: true,
    },
  });
  assert.deepEqual(s, {
    elevenLabsEnabled: true,
    elevenLabsToolId: "tool-1",
    voiceResponsePercent: 50,
    replyWithAudioOnInboundAudio: true,
    replyWithTextOnInboundAudio: false,
  });
});

test("shouldSendVoiceReply respects enable flag and inbound audio option", () => {
  const base = {
    elevenLabsEnabled: true,
    elevenLabsToolId: "tool-1",
    voiceResponsePercent: 100,
    replyWithAudioOnInboundAudio: false,
    replyWithTextOnInboundAudio: false,
  };
  assert.equal(shouldSendVoiceReply({ ...base, elevenLabsEnabled: false }, { type: "TEXT" }), false);
  assert.equal(
    shouldSendVoiceReply(
      { ...base, replyWithAudioOnInboundAudio: true, voiceResponsePercent: 0 },
      { type: "AUDIO" },
    ),
    true,
  );
  assert.equal(
    shouldSendVoiceReply(
      {
        elevenLabsEnabled: false,
        elevenLabsToolId: null,
        voiceResponsePercent: 0,
        replyWithAudioOnInboundAudio: true,
      },
      { type: "AUDIO" },
    ),
    true,
  );
  assert.equal(shouldSendVoiceReply({ ...base, voiceResponsePercent: 0 }, { type: "TEXT" }), false);
  assert.equal(
    shouldSendVoiceReply(
      { ...base, replyWithTextOnInboundAudio: true, replyWithAudioOnInboundAudio: true },
      { type: "AUDIO" },
    ),
    false,
  );
  assert.equal(
    shouldSendVoiceReply({ ...base, replyWithTextOnInboundAudio: true, voiceResponsePercent: 100 }, { type: "AUDIO" }),
    false,
  );
});
