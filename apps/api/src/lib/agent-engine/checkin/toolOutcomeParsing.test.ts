import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractHttpToolFailureFromWrapper,
  httpToolBodyIndicatesFailure,
} from "./toolOutcomeParsing.js";

test("httpToolBodyIndicatesFailure detects validationError", () => {
  assert.equal(
    httpToolBodyIndicatesFailure({ validationError: true, missingFields: ["embratur.snmotvia"] }),
    true,
  );
});

test("extractHttpToolFailureFromWrapper peels bodyPreview", () => {
  assert.equal(
    extractHttpToolFailureFromWrapper({
      ok: true,
      bodyPreview: JSON.stringify({ validationError: true, missingFields: ["a"] }),
    }),
    true,
  );
});

test("extractHttpToolFailureFromWrapper passes clean HTTP ok wrapper", () => {
  assert.equal(
    extractHttpToolFailureFromWrapper({
      ok: true,
      bodyPreview: JSON.stringify({ validatedCheckin: 1, message: "Check-in realizado com sucesso" }),
    }),
    false,
  );
});
