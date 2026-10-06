import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nvoipEncodeClientCredentialsBasic,
  nvoipQuotePlus,
  readNvoipUserDirectoryPage,
} from "./nvoipClient.js";

test("nvoip v3 basic auth matches quote_plus client_id:client_secret", () => {
  const clientId = "client: &+á";
  const clientSecret = "dummy: &+é";
  const decoded = Buffer.from(
    nvoipEncodeClientCredentialsBasic(clientId, clientSecret),
    "base64",
  ).toString("utf8");
  assert.equal(decoded, `${nvoipQuotePlus(clientId)}:${nvoipQuotePlus(clientSecret)}`);
  assert.match(decoded, /client%3A\+%26%2B/);
  assert.doesNotMatch(decoded, / /);
});

test("GET /v3/users page uses content, extension and panel access", () => {
  const page = readNvoipUserDirectoryPage({
    content: [
      {
        id: "user-1",
        name: "Atendente",
        extension: "110937011",
        panelAccessStatus: "ACTIVE",
        sipStatus: "ACTIVE",
      },
    ],
    number: 0,
    totalPages: 2,
    last: false,
  });
  assert.equal(page.recognized, true);
  assert.equal(page.hasNext, true);
  assert.equal(page.users.length, 1);
  assert.equal(page.users[0]?.id, "user-1");
  assert.equal(page.users[0]?.numbersip, "110937011");
  assert.equal(page.users[0]?.webphone, true);
});

test("GET /v3/users last page stops pagination", () => {
  const page = readNvoipUserDirectoryPage({
    content: [{ id: "user-2", extension: "110937002", panelAccessStatus: "INACTIVE" }],
    last: true,
  });
  assert.equal(page.hasNext, false);
  assert.equal(page.users[0]?.webphone, false);
});
