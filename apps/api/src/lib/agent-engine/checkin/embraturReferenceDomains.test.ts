import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFilteredLookupArgs, buildListDomainArgs, domainsForKind } from "./embraturReferenceDomains.js";

test("domainsForKind puts embratur_cb_country first for pais", () => {
  const domains = domainsForKind("pais");
  assert.equal(domains[0], "embratur_cb_country");
  assert.ok(domains.includes("paises"));
});

test("buildListDomainArgs uses dominio", () => {
  assert.deepEqual(buildListDomainArgs("embratur_cb_country"), {
    dominio: "embratur_cb_country",
    domain: "embratur_cb_country",
  });
});

test("buildFilteredLookupArgs includes FNRH domain for cidade", () => {
  const args = buildFilteredLookupArgs("cidade", "São Paulo");
  assert.ok(args.some((a) => a.dominio === "embratur_cb_city"));
  assert.ok(args.some((a) => a.cidade === "São Paulo"));
});
