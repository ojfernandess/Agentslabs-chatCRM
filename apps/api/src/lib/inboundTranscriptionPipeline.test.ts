import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@prisma/client";
import {
  awaitInboundTranscriptionGate,
  inboundMessageNeedsTranscription,
  raceWithTimeout,
} from "./inboundTranscriptionPipeline.js";

function sampleMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    direction: "INBOUND",
    type: "AUDIO",
    body: null,
    mediaUrl: "https://example.com/audio.ogg",
    mediaType: "audio/ogg",
    providerMsgId: "wamid-1",
    status: "DELIVERED",
    providerError: null,
    isPrivate: false,
    sentAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    channel: null,
    actorUserId: null,
    replyToMessageId: null,
    replyToExternalMsgId: null,
    ...overrides,
  };
}

const noopLog = {
  warn: () => {},
  error: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => noopLog,
} as never;

test("inboundMessageNeedsTranscription detects audio without body", () => {
  assert.equal(
    inboundMessageNeedsTranscription(sampleMessage(), {
      audioTranscriptionEnabled: true,
      imageTranscriptionEnabled: false,
    }),
    true,
  );
});

test("inboundMessageNeedsTranscription skips when body already present", () => {
  assert.equal(
    inboundMessageNeedsTranscription(sampleMessage({ body: "hello" }), {
      audioTranscriptionEnabled: true,
      imageTranscriptionEnabled: true,
    }),
    false,
  );
});

test("raceWithTimeout returns result when promise resolves quickly", async () => {
  const value = await raceWithTimeout(Promise.resolve("ok"), 50, "fallback");
  assert.equal(value, "ok");
});

test("raceWithTimeout returns fallback on timeout", async () => {
  const value = await raceWithTimeout(
    new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200)),
    20,
    "fallback",
  );
  assert.equal(value, "fallback");
});

test("awaitInboundTranscriptionGate returns original when waitForTranscription is false", async () => {
  const original = sampleMessage();
  const updated = sampleMessage({ body: "[Transcrição automática] ola" });
  const result = await awaitInboundTranscriptionGate({
    organizationId: "org-1",
    conversationId: "conv-1",
    message: original,
    transcription: {
      needsTranscription: true,
      promise: Promise.resolve(updated),
    },
    waitForTranscription: false,
    transcriptionTimeoutMs: 100,
    log: noopLog,
  });
  assert.equal(result.message.id, original.id);
  assert.equal(result.message.body, null);
  assert.equal(result.timedOut, false);
});

test("awaitInboundTranscriptionGate waits and returns transcribed message", async () => {
  const original = sampleMessage();
  const updated = sampleMessage({ body: "[Transcrição automática] ola" });
  const result = await awaitInboundTranscriptionGate({
    organizationId: "org-1",
    conversationId: "conv-1",
    message: original,
    transcription: {
      needsTranscription: true,
      promise: Promise.resolve(updated),
    },
    waitForTranscription: true,
    transcriptionTimeoutMs: 100,
    log: noopLog,
  });
  assert.equal(result.message.body, updated.body);
  assert.equal(result.timedOut, false);
});

test("awaitInboundTranscriptionGate times out and keeps original body", async () => {
  const original = sampleMessage();
  const result = await awaitInboundTranscriptionGate({
    organizationId: "org-1",
    conversationId: "conv-1",
    message: original,
    transcription: {
      needsTranscription: true,
      promise: new Promise<Message>((resolve) => {
        setTimeout(() => resolve(sampleMessage({ body: "[Transcrição automática] tarde" })), 200);
      }),
    },
    waitForTranscription: true,
    transcriptionTimeoutMs: 20,
    log: noopLog,
  });
  assert.equal(result.message.body, null);
  assert.equal(result.timedOut, true);
});
