import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCachedWhatsAppProviderBundle,
  runWithRequestLookupCache,
} from "./requestLookupCache.js";

describe("requestLookupCache", () => {
  it("deduplicates whatsapp bundle loaders within the same request scope", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { provider: null, kind: "meta" };
    };

    await runWithRequestLookupCache(async () => {
      const first = await getCachedWhatsAppProviderBundle("org-1", "inbox-1", loader);
      const second = await getCachedWhatsAppProviderBundle("org-1", "inbox-1", loader);
      assert.equal(first.kind, "meta");
      assert.equal(second.kind, "meta");
      assert.equal(calls, 1);
    });
  });

  it("does not share cache across separate request scopes", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { provider: null, kind: "meta" };
    };

    await runWithRequestLookupCache(() => getCachedWhatsAppProviderBundle("org-1", "inbox-1", loader));
    await runWithRequestLookupCache(() => getCachedWhatsAppProviderBundle("org-1", "inbox-1", loader));
    assert.equal(calls, 2);
  });
});
