import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleOAuthAuthorizeUrl,
  createGoogleOAuthState,
  signGoogleOAuthState,
  verifyGoogleOAuthState,
} from "./googleCalendarOAuth.js";
import { googleCalendarOAuthCallbackUrl } from "../config.js";
import {
  isWithinGoogleCalendarAvailability,
  resolveGoogleCalendarId,
} from "./googleCalendarToolExecute.js";

describe("googleCalendarOAuth", () => {
  it("builds authorize URL with fixed callback redirect_uri", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-for-google-oauth";
    process.env.PUBLIC_URL = "https://api.example.com";
    const state = createGoogleOAuthState({
      organizationId: "org-1",
      toolId: "tool-1",
    });
    const url = new URL(
      buildGoogleOAuthAuthorizeUrl({ clientId: "client.apps.googleusercontent.com", state }),
    );
    assert.equal(url.searchParams.get("redirect_uri"), googleCalendarOAuthCallbackUrl());
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "select_account consent");
    assert.match(url.searchParams.get("scope") ?? "", /calendar/);
    assert.match(url.searchParams.get("scope") ?? "", /email/);
  });

  it("signs and verifies oauth state", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-for-google-oauth";
    const payload = {
      organizationId: "org-abc",
      toolId: "tool-xyz",
      exp: Date.now() + 60_000,
    };
    const state = signGoogleOAuthState(payload);
    const parsed = verifyGoogleOAuthState(state);
    assert.deepEqual(parsed, payload);
  });

  it("rejects expired oauth state", () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-for-google-oauth";
    const state = signGoogleOAuthState({
      organizationId: "org-abc",
      toolId: "tool-xyz",
      exp: Date.now() - 1,
    });
    assert.equal(verifyGoogleOAuthState(state), null);
  });
});

describe("googleCalendarToolExecute helpers", () => {
  it("resolves calendar id by friendly name", () => {
    const id = resolveGoogleCalendarId(
      "Receção",
      [
        { id: "primary", name: "Principal" },
        { id: "cal-2", name: "Receção" },
      ],
      "primary",
    );
    assert.equal(id, "cal-2");
  });

  it("blocks events outside configured availability window", () => {
    const mondayMorning = new Date("2026-08-03T08:30:00-03:00");
    const mondayEnd = new Date("2026-08-03T09:00:00-03:00");
    const result = isWithinGoogleCalendarAvailability(
      mondayMorning.toISOString(),
      mondayEnd.toISOString(),
      { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "outside_availability_window");
  });
});
