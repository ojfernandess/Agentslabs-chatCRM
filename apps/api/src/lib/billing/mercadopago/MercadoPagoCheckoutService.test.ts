import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapMercadoPagoPreapprovalStatus } from "../billingTypes.js";

describe("MercadoPago checkout helpers", () => {
  it("mapMercadoPagoPreapprovalStatus maps MP statuses to internal subscription statuses", () => {
    assert.equal(mapMercadoPagoPreapprovalStatus("authorized"), "active");
    assert.equal(mapMercadoPagoPreapprovalStatus("pending"), "incomplete");
    assert.equal(mapMercadoPagoPreapprovalStatus("paused"), "paused");
    assert.equal(mapMercadoPagoPreapprovalStatus("cancelled"), "canceled");
    assert.equal(mapMercadoPagoPreapprovalStatus("unknown"), "inactive");
  });
});
