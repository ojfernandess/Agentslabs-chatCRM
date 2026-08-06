import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deduplicateUrlsInReply,
  normalizeMarkdownLinksInReply,
  sanitizeOutboundLinksInReply,
} from "./replyLinks.js";

test("normalizeMarkdownLinksInReply converts broken markdown with URL in label", () => {
  const raw =
    "O link é [https://checkin.audaar.com.br/]() para check-in.";
  assert.equal(
    normalizeMarkdownLinksInReply(raw),
    "O link é https://checkin.audaar.com.br/ para check-in.",
  );
});

test("normalizeMarkdownLinksInReply converts standard markdown link to plain URL", () => {
  const raw = "Acesse [site oficial](https://example.com/path) agora.";
  assert.equal(normalizeMarkdownLinksInReply(raw), "Acesse https://example.com/path agora.");
});

test("deduplicateUrlsInReply dedupes any domain not only check-in", () => {
  const dup =
    "Wi-Fi: https://hotel.example/wifi\n\n" +
    "Mapa: https://hotel.example/wifi\n\n" +
    "Endereço: https://maps.example/place";
  const out = deduplicateUrlsInReply(dup);
  assert.equal((out.match(/hotel\.example\/wifi/gi) ?? []).length, 1);
  assert.match(out, /maps\.example\/place/);
});

test("deduplicateUrlsInReply still prefers check-in URL with locator when mixed", () => {
  const dup =
    "Link: https://pms.audaar.com.br/checkin/vivapp/access\n\n" +
    "🔗 https://checkin.audaar.com.br/HHTIDAS";
  const out = deduplicateUrlsInReply(dup);
  assert.equal((out.match(/https?:\/\//g) ?? []).length, 1);
  assert.match(out, /checkin\.audaar\.com\.br\/HHTIDAS/i);
});

test("sanitizeOutboundLinksInReply fixes markdown then dedupes", () => {
  const raw =
    "Link: [https://checkin.audaar.com.br/]()\n\n" +
    "🔗 https://checkin.audaar.com.br/";
  const out = sanitizeOutboundLinksInReply(raw);
  assert.doesNotMatch(out, /\[https?:\/\//);
  assert.equal((out.match(/checkin\.audaar\.com\.br/gi) ?? []).length, 1);
});
