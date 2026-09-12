import assert from "node:assert/strict";
import test from "node:test";
import { deriveEvolutionGoUiState } from "./whatsappConnectionUiState.js";

test("deriveEvolutionGoUiState treats missing instance as not configured", () => {
  assert.equal(
    deriveEvolutionGoUiState({
      hasInstance: true,
      status: { connected: false, loggedIn: false, instanceMissing: true },
    }),
    "not_configured",
  );
});

test("deriveEvolutionGoUiState does not show error for unreachable alone", () => {
  assert.equal(
    deriveEvolutionGoUiState({
      hasInstance: true,
      status: { connected: false, loggedIn: false, unreachable: true },
    }),
    "configured_disconnected",
  );
});
