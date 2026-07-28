import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractEvolutionGoSendMessageId } from "./evolutionGo.js";

describe("extractEvolutionGoSendMessageId", () => {
  it("reads data.Info.ID (docs shape)", () => {
    const id = extractEvolutionGoSendMessageId({
      message: "success",
      data: {
        Info: { ID: "3EB0000000000000000010", IsFromMe: true },
        Message: { extendedTextMessage: { text: "oi" } },
      },
    });
    assert.equal(id, "3EB0000000000000000010");
  });

  it("reads root messageId", () => {
    assert.equal(extractEvolutionGoSendMessageId({ messageId: "MSG-1" }), "MSG-1");
  });

  it("reads data.key.id (Baileys-like)", () => {
    const id = extractEvolutionGoSendMessageId({
      data: { key: { id: "BAE594145F4C59B4", fromMe: true } },
    });
    assert.equal(id, "BAE594145F4C59B4");
  });

  it("returns null when only Message body is present (legacy Go)", () => {
    assert.equal(
      extractEvolutionGoSendMessageId({
        message: "success",
        data: { Message: { extendedTextMessage: { text: "oi" } } },
      }),
      null,
    );
  });
});
