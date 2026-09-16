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
      {
        ...base,
        replyWithAudioOnInboundAudio: true,
        elevenLabsEnabled: false,
        voiceResponsePercent: 0,
      },
      { type: "AUDIO" },
    ),
    true,
  );
  assert.equal(
    shouldSendVoiceReply(
      {
        ...base,
        replyWithAudioOnInboundAudio: true,
        inboundAudioResponsePercent: 0,
        nativeVoiceResponsePercent: 100,
      },
      { type: "AUDIO" },
    ),
    true,
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

test("parseAgentVoiceSettings respects explicit nativeVoiceEnabled false over legacy percent", () => {
  const s = parseAgentVoiceSettings({
    voice: {
      nativeVoiceEnabled: false,
      voiceResponsePercent: 100,
      replyWithAudioOnInboundAudio: false,
    },
  });
  assert.equal(s.nativeVoiceEnabled, false);
  assert.equal(
    shouldSendVoiceReply(s, { type: "TEXT" }),
    false,
  );
});

test("shouldSendVoiceReply ignores inbound-only mode when native voice is enabled", () => {
  assert.equal(
    shouldSendVoiceReply(
      {
        nativeVoiceEnabled: true,
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
    false,
  );
});
