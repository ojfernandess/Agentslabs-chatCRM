import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sipInboundLeadPhone } from "./sipInboundLead.js";

describe("sipInboundLeadPhone", () => {
  it("normalizes a Brazilian caller number", () => {
    assert.equal(sipInboundLeadPhone("5513997743936"), "+5513997743936");
    assert.equal(sipInboundLeadPhone("+55 13 99774-3936"), "+5513997743936");
  });

  it("ignores placeholders and short extensions", () => {
    assert.equal(sipInboundLeadPhone("inbound"), null);
    assert.equal(sipInboundLeadPhone("anonymous"), null);
    assert.equal(sipInboundLeadPhone("1001"), null);
    assert.equal(sipInboundLeadPhone(""), null);
    assert.equal(sipInboundLeadPhone(null), null);
  });
});
