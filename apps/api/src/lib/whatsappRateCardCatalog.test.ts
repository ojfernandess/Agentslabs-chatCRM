import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getWhatsappRateCardCatalog,
  listWhatsappRateCardCatalogs,
  validateWhatsappRateCardImport,
} from "./whatsappRateCardCatalog.js";

describe("whatsappRateCardCatalog", () => {
  it("lists embedded Meta catalogs", () => {
    const catalogs = listWhatsappRateCardCatalogs();
    assert.ok(catalogs.length >= 3);
    assert.ok(catalogs.some((c) => c.id === "meta-2026-07-usd"));
    assert.ok(catalogs.some((c) => c.id === "meta-2026-10-usd"));
  });

  it("loads catalog by id", () => {
    const c = getWhatsappRateCardCatalog("meta-2026-07-brl-brazil");
    assert.equal(c?.currency, "BRL");
    assert.equal(c?.entries.length, 3);
  });

  it("validates custom import JSON", () => {
    const valid = validateWhatsappRateCardImport({
      id: "custom-test",
      version: "test-1",
      label: "Test",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      source: "https://developers.facebook.com/docs/whatsapp/pricing/",
      currency: "USD",
      entries: [{ market: "Brazil", countryCode: "55", category: "MARKETING", price: 0.05 }],
    });
    assert.ok(valid);
    assert.equal(validateWhatsappRateCardImport({ bad: true }), null);
  });
});
