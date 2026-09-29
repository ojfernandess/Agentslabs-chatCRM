import assert from "node:assert/strict";
import { test } from "node:test";
import { inboundMessageNeedsDeferredMediaDownload } from "./inboundMediaDeferredDownload.js";

test("inboundMessageNeedsDeferredMediaDownload true for meta media when enabled", () => {
  assert.equal(
    inboundMessageNeedsDeferredMediaDownload({
      deferEnabled: true,
      whatsappProvider: "meta",
      msgType: "IMAGE",
      metaMediaId: "media-1",
    }),
    true,
  );
});

test("inboundMessageNeedsDeferredMediaDownload false when URL already present", () => {
  assert.equal(
    inboundMessageNeedsDeferredMediaDownload({
      deferEnabled: true,
      whatsappProvider: "meta",
      msgType: "IMAGE",
      metaMediaId: "media-1",
      existingMediaUrl: "https://cdn.example/a.jpg",
    }),
    false,
  );
});

test("inboundMessageNeedsDeferredMediaDownload false for audio and image OCR", () => {
  assert.equal(
    inboundMessageNeedsDeferredMediaDownload({
      deferEnabled: true,
      whatsappProvider: "meta",
      msgType: "AUDIO",
      metaMediaId: "media-1",
    }),
    false,
  );
  assert.equal(
    inboundMessageNeedsDeferredMediaDownload({
      deferEnabled: true,
      whatsappProvider: "meta",
      msgType: "IMAGE",
      metaMediaId: "media-1",
      imageTranscriptionEnabled: true,
    }),
    false,
  );
});

test("inboundMessageNeedsDeferredMediaDownload false when feature disabled", () => {
  assert.equal(
    inboundMessageNeedsDeferredMediaDownload({
      deferEnabled: false,
      whatsappProvider: "meta",
      msgType: "IMAGE",
      metaMediaId: "media-1",
    }),
    false,
  );
});
