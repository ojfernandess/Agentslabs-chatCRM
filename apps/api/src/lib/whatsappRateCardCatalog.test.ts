import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findEmbeddedWhatsappRate,
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

  it("uses the October USD card for Service after 2026-10-01", () => {
    const rate = findEmbeddedWhatsappRate({
      phoneDigits: "5511999999999",
      category: "SERVICE",
      at: new Date("2026-10-07T12:00:00.000Z"),
    });
    assert.equal(rate?.price, 0.0068);
    assert.equal(rate?.currency, "USD");
    assert.equal(rate?.version, "2026-10");
  });

  it("prefers the BRL card when two cards start on the same day", () => {
    const july = findEmbeddedWhatsappRate({
      phoneDigits: "5511999999999",
      category: "MARKETING",
      at: new Date("2026-07-15T12:00:00.000Z"),
    });
    assert.equal(july?.price, 0.3217);
    assert.equal(july?.currency, "BRL");

    const september = findEmbeddedWhatsappRate({
      phoneDigits: "5511999999999",
      category: "MARKETING",
      at: new Date("2026-09-15T12:00:00.000Z"),
    });
    assert.equal(september?.currency, "BRL");
    assert.equal(september?.price, 0.3217);
  });
});
