import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentVoiceSettings, shouldSendVoiceReply } from "./agentVoiceSettings.js";

test("parseAgentVoiceSettings reads nested voice block", () => {
  const s = parseAgentVoiceSettings({
    voice: {
      nativeVoiceEnabled: true,
      nativeVoiceResponsePercent: 50,
      inboundAudioResponsePercent: 75,
      elevenLabsEnabled: true,
      elevenLabsToolId: "tool-1",
      voiceResponsePercent: 50,
      replyWithAudioOnInboundAudio: true,
    },
  });
  assert.deepEqual(s, {
    nativeVoiceEnabled: true,
    nativeVoiceResponsePercent: 50,
    inboundAudioResponsePercent: 75,
    elevenLabsEnabled: true,
    elevenLabsToolId: "tool-1",
    voiceResponsePercent: 50,
    replyWithAudioOnInboundAudio: true,
    replyWithTextOnInboundAudio: false,
  });
});

test("shouldSendVoiceReply respects native, inbound audio and ElevenLabs override", () => {
  const base = {
    nativeVoiceEnabled: true,
    nativeVoiceResponsePercent: 100,
    inboundAudioResponsePercent: 100,
    elevenLabsEnabled: true,
    elevenLabsToolId: "tool-1",
    voiceResponsePercent: 100,
    replyWithAudioOnInboundAudio: false,
    replyWithTextOnInboundAudio: false,
  };
  assert.equal(shouldSendVoiceReply({ ...base, elevenLabsEnabled: false }, { type: "TEXT" }), true);
  assert.equal(
    shouldSendVoiceReply(
      { ...base, nativeVoiceEnabled: false, elevenLabsEnabled: false },
      { type: "TEXT" },
    ),
    false,
  );
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
        ...base,
        replyWithAudioOnInboundAudio: true,
        voiceResponsePercent: 100,
        inboundAudioResponsePercent: 0,
      },
      { type: "AUDIO" },
    ),
    false,
  );
  assert.equal(
    shouldSendVoiceReply(
      {
        nativeVoiceEnabled: false,
        nativeVoiceResponsePercent: 0,
        inboundAudioResponsePercent: 100,
        elevenLabsEnabled: false,
        elevenLabsToolId: null,
        voiceResponsePercent: 0,
        replyWithAudioOnInboundAudio: true,
        replyWithTextOnInboundAudio: false,
      },
      { type: "AUDIO" },
    ),
    true,
  );
  assert.equal(
    shouldSendVoiceReply(
      { ...base, replyWithTextOnInboundAudio: true, replyWithAudioOnInboundAudio: true },
      { type: "AUDIO" },
    ),
    false,
  );
  assert.equal(shouldSendVoiceReply({ ...base, voiceResponsePercent: 0 }, { type: "TEXT" }), false);
});
