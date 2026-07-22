import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHttpToolFlatContext,
  buildHttpToolAttachmentRecord,
  buildSchemaFillSources,
  collectMissingRequiredSchemaFields,
  expandTemplateValue,
  extractInlineBodyFromArgs,
  fillMissingRequiredSchemaFields,
  normalizeLlmArgsKeyAliases,
  resolveHttpRequestBody,
} from "./automationHttpToolExecute.js";

test("resolveHttpRequestBody uses inline args when body and bodyTemplate are absent", () => {
  const args = {
    mode: "digital",
    approveCheckin: true,
    mainGuest: {
      name: "João Carlos Silva",
      email: "joao.silva@teste.com",
    },
    sampleContext: {},
  };
  const flat = buildHttpToolFlatContext(args);
  const resolved = resolveHttpRequestBody({ cfg: { bodyTemplate: {} }, args, flat });
  assert.equal(resolved.source, "inline");
  const parsed = JSON.parse(resolved.bodyStr ?? "{}") as Record<string, unknown>;
  assert.equal(parsed.mode, "digital");
  assert.deepEqual(parsed.mainGuest, {
    name: "João Carlos Silva",
    email: "joao.silva@teste.com",
  });
});

test("resolveHttpRequestBody prefers explicit body over inline args", () => {
  const args = {
    body: { hello: "world" },
    mode: "ignored",
  };
  const flat = buildHttpToolFlatContext(args);
  const resolved = resolveHttpRequestBody({ cfg: {}, args, flat });
  assert.equal(resolved.source, "explicit");
  assert.equal(resolved.bodyStr, JSON.stringify({ hello: "world" }));
});

test("resolveHttpRequestBody expands bodyTemplate placeholders from sampleContext", () => {
  const args = {
    sampleContext: {
      nome: "Maria",
      email: "maria@teste.com",
    },
  };
  const flat = buildHttpToolFlatContext(args);
  const resolved = resolveHttpRequestBody({
    cfg: {
      bodyTemplate: {
        mainGuest: {
          name: "{{nome}}",
          email: "{{email}}",
        },
      },
    },
    args,
    flat,
  });
  assert.equal(resolved.source, "template");
  const parsed = JSON.parse(resolved.bodyStr ?? "{}") as {
    mainGuest: { name: string; email: string };
  };
  assert.equal(parsed.mainGuest.name, "Maria");
  assert.equal(parsed.mainGuest.email, "maria@teste.com");
});

test("extractInlineBodyFromArgs excludes reserved transport keys", () => {
  const inline = extractInlineBodyFromArgs({
    pathParams: { reservationId: "123" },
    query: { debug: "1" },
    headers: { "X-Test": "1" },
    body: { ignored: true },
    sampleContext: { nome: "Ana" },
    mode: "digital",
  });
  assert.deepEqual(inline, { mode: "digital" });
});

test("expandTemplateValue preserves arrays and nested objects", () => {
  const out = expandTemplateValue(
    {
      dependents: [{ name: "{{dep_name}}" }],
      mode: "{{mode}}",
    },
    { dep_name: "Filho", mode: "digital" },
  ) as Record<string, unknown>;
  assert.equal(out.mode, "digital");
  assert.deepEqual(out.dependents, [{ name: "Filho" }]);
});

test("resolveHttpRequestBody expands mediaBase64 from sampleContext in JSON body", () => {
  const args = {
    sampleContext: {
      mediaBase64: "abc123",
      reservationId: "R-99",
    },
  };
  const flat = buildHttpToolFlatContext(args);
  const resolved = resolveHttpRequestBody({
    cfg: {
      bodyTemplate: {
        reservationId: "{{reservationId}}",
        photoBase64: "{{mediaBase64}}",
      },
    },
    args,
    flat,
  });
  const parsed = JSON.parse(resolved.bodyStr ?? "{}") as { reservationId: string; photoBase64: string };
  assert.equal(parsed.reservationId, "R-99");
  assert.equal(parsed.photoBase64, "abc123");
});

test("resolveHttpRequestBody builds multipart when bodyType is multipart and media is present", () => {
  const args = { sampleContext: { guestName: "Maria" } };
  const flat = buildHttpToolFlatContext(args);
  const media = {
    mediaUrl: "https://example.com/api/v1/messages/media/abc123.png",
    mediaType: "image/png",
    filename: "abc123.png",
    buffer: Buffer.from("fake-image"),
    base64: "ZmFrZS1pbWFnZQ==",
  };
  const resolved = resolveHttpRequestBody({
    cfg: {
      bodyType: "multipart",
      multipartFileField: "photo",
      bodyTemplate: { guestName: "{{guestName}}" },
    },
    args,
    flat,
    inboundMedia: media,
  });
  assert.equal(resolved.source, "multipart");
  assert.ok(resolved.multipartFormData);
});

test("buildHttpToolAttachmentRecord exposes url, base64 and hasBinary flags", () => {
  const attachment = buildHttpToolAttachmentRecord({
    messageId: "msg-1",
    type: "IMAGE",
    createdAt: "2026-01-01T00:00:00.000Z",
    loaded: {
      mediaUrl: "https://example.com/a.png",
      mediaType: "image/png",
      filename: "a.png",
      buffer: Buffer.from("bin"),
      base64: "Ymlu",
    },
  });
  assert.ok(attachment);
  assert.equal(attachment!.url, "https://example.com/a.png");
  assert.equal(attachment!.base64, "Ymlu");
  assert.equal(attachment!.hasBinary, true);
  assert.equal(attachment!.base64Available, true);
});

test("normalizeLlmArgsKeyAliases fixes common reservationId typo from the model", () => {
  const schema = {
    type: "object",
    properties: {
      reservationIdOrLocalizer: { type: "string" },
      type: { type: "string" },
    },
    required: ["reservationIdOrLocalizer"],
  };
  const normalized = normalizeLlmArgsKeyAliases(
    { reservationIdOrLocalLocalizer: "A3FIULCZ", type: "document" },
    schema,
  );
  assert.equal(normalized.reservationIdOrLocalizer, "A3FIULCZ");
  assert.equal(normalized.type, "document");
});

test("normalizeLlmArgsKeyAliases fixes nested object key typos", () => {
  const schema = {
    type: "object",
    properties: {
      mainGuest: {
        type: "object",
        properties: {
          mobilePhoneNumber: { type: "string" },
        },
        required: ["mobilePhoneNumber"],
      },
    },
  };
  const normalized = normalizeLlmArgsKeyAliases(
    { mainGuest: { mobilePhoneNumer: "+5511999999999" } },
    schema,
  );
  const guest = normalized.mainGuest as Record<string, unknown>;
  assert.equal(guest.mobilePhoneNumber, "+5511999999999");
});

test("fillMissingRequiredSchemaFields applies schema defaults and flowSlots", () => {
  const schema = {
    type: "object",
    properties: {
      reservationIdOrLocalizer: { type: "string" },
      approveCheckin: { type: "boolean", default: true },
      sentToReception: { type: "boolean", default: false },
      validatedCheckin: { type: "boolean", default: true },
    },
    required: ["reservationIdOrLocalizer", "approveCheckin", "sentToReception", "validatedCheckin"],
  };
  const llmArgs = {
    sampleContext: {
      flowSlots: { reservationIdOrLocalizer: "A3FIULCZ" },
    },
  };
  const fillSources = buildSchemaFillSources(llmArgs, { argDefaults: {} });
  const { data, applied } = fillMissingRequiredSchemaFields({
    schema,
    data: llmArgs,
    fillSources,
  });
  assert.equal(data.reservationIdOrLocalizer, "A3FIULCZ");
  assert.equal(data.approveCheckin, true);
  assert.equal(data.sentToReception, false);
  assert.equal(data.validatedCheckin, true);
  assert.ok(applied.length >= 4);
  assert.equal(collectMissingRequiredSchemaFields(schema, data).length, 0);
});
test("buildHttpToolFlatContext promotes flowSlots to top-level template keys", () => {
  const flat = buildHttpToolFlatContext({
    sampleContext: {
      flowSlots: { guestId: "G-1", reservationIdOrLocalizer: "ABC" },
    },
  });
  assert.equal(flat.guestId, "G-1");
  assert.equal(flat.reservationIdOrLocalizer, "ABC");
  assert.equal(flat["flowSlots.guestId"], "G-1");
});

test("flattenTemplateContext exposes nested attachment and attachments array paths", () => {
  const flat = buildHttpToolFlatContext({
    sampleContext: {
      attachment: { url: "https://x/y.jpg", base64: "abc" },
      attachments: [{ base64: "first" }, { base64: "second" }],
    },
  });
  assert.equal(flat["attachment.url"], "https://x/y.jpg");
  assert.equal(flat["attachment.base64"], "abc");
  assert.equal(flat["attachments.0.base64"], "first");
  assert.equal(flat["attachments.1.base64"], "second");
});
