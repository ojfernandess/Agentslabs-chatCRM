import assert from "node:assert/strict";
import { test } from "node:test";
import { createClientOutboundTokenStream } from "./clientOutboundTokenStream.js";

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => noopLog,
} as import("fastify").FastifyBaseLogger;

test("createClientOutboundTokenStream flushes chunks without duplicating final text", async () => {
  const chunks: string[] = [];
  const stream = createClientOutboundTokenStream({
    organizationId: "org",
    botId: "bot",
    conversationId: "conv",
    contactId: "contact",
    log: noopLog,
    minChunkChars: 20,
    chunkDelayMs: 0,
    deliverChunk: async (chunk) => {
      chunks.push(chunk);
    },
  });

  const text =
    "Esta é uma resposta longa o suficiente para gerar pelo menos um chunk antes do final.";
  stream.onTokenDelta(text);
  const finished = await stream.finish();

  assert.ok(chunks.length >= 1);
  assert.equal(finished.deliveredText.replace(/\n/g, " "), text.trim());
  assert.equal(chunks.join(" "), text.trim());
});

test("createClientOutboundTokenStream returns zero chunks for empty generation", async () => {
  const chunks: string[] = [];
  const stream = createClientOutboundTokenStream({
    organizationId: "org",
    botId: "bot",
    conversationId: "conv",
    contactId: "contact",
    log: noopLog,
    chunkDelayMs: 0,
    deliverChunk: async (chunk) => {
      chunks.push(chunk);
    },
  });

  const finished = await stream.finish();
  assert.equal(chunks.length, 0);
  assert.equal(finished.chunkCount, 0);
});
