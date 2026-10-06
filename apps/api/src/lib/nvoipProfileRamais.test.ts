import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProfileDidDestination,
  didDestinationMatches,
  normalizeProfileRamais,
  shouldRouteDidToProfileRamais,
} from "./nvoipProfileRamais.js";

test("normalizeProfileRamais keeps unique numeric extensions in stable order", () => {
  assert.deepEqual(
    normalizeProfileRamais(["110937011", "110937002", "110937011", "ramal 110937006"]),
    ["110937002", "110937006", "110937011"],
  );
});

test("buildProfileDidDestination joins the profile ramais", () => {
  assert.equal(buildProfileDidDestination(["110937011", "110937002"]), "110937002,110937011");
  assert.equal(buildProfileDidDestination(["", "abc"]), null);
});

test("shouldRouteDidToProfileRamais only accepts extension lists", () => {
  assert.equal(shouldRouteDidToProfileRamais("110937011,110937002,110937006"), true);
  assert.equal(shouldRouteDidToProfileRamais("110937011;110937002"), true);
  assert.equal(shouldRouteDidToProfileRamais("ura-vendas"), false);
  assert.equal(shouldRouteDidToProfileRamais("1.2.3.4"), false);
  assert.equal(shouldRouteDidToProfileRamais("https://pbx.example/ivr"), false);
  assert.equal(shouldRouteDidToProfileRamais(""), false);
  assert.equal(shouldRouteDidToProfileRamais(null), false);
});

test("didDestinationMatches ignores order and separators", () => {
  assert.equal(didDestinationMatches("110937011,110937002", "110937002,110937011"), true);
  assert.equal(didDestinationMatches("110937011", "110937011,110937002"), false);
});
