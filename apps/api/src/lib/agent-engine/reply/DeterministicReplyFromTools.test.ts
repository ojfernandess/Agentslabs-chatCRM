import assert from "node:assert/strict";
import test from "node:test";
import { buildDeterministicReplyFromToolOutcomes } from "./DeterministicReplyFromTools.js";

test("buildDeterministicReplyFromToolOutcomes skips call_human internal ack", () => {
  const reply = buildDeterministicReplyFromToolOutcomes([
    {
      name: "call_human",
      ok: true,
      preview: JSON.stringify({ message: "Conversa aberta para atendimento humano." }),
    },
  ]);
  assert.match(reply, /consultei o sistema/i);
  assert.doesNotMatch(reply, /Conversa aberta para atendimento humano/i);
  assert.doesNotMatch(reply, /Segue o resultado da consulta/i);
});
