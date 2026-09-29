import assert from "node:assert/strict";
import { test } from "node:test";
import { appendPostgresUrlParams, resolvePrismaDatasourceUrl } from "./prismaDatasourceUrl.js";

test("appendPostgresUrlParams preserves existing query keys", () => {
  const url = appendPostgresUrlParams(
    "postgresql://u:p@localhost:5432/db?sslmode=require",
    { connection_limit: 8 },
  );
  assert.match(url, /sslmode=require/);
  assert.match(url, /connection_limit=8/);
});

test("resolvePrismaDatasourceUrl applies pool env when absent in URL", () => {
  const prevLimit = process.env.PRISMA_CONNECTION_LIMIT;
  const prevTimeout = process.env.PRISMA_POOL_TIMEOUT;
  const prevUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/openconduit";
  process.env.PRISMA_CONNECTION_LIMIT = "12";
  process.env.PRISMA_POOL_TIMEOUT = "30";

  const resolved = resolvePrismaDatasourceUrl();
  assert.match(resolved, /connection_limit=12/);
  assert.match(resolved, /pool_timeout=30/);

  if (prevLimit === undefined) delete process.env.PRISMA_CONNECTION_LIMIT;
  else process.env.PRISMA_CONNECTION_LIMIT = prevLimit;
  if (prevTimeout === undefined) delete process.env.PRISMA_POOL_TIMEOUT;
  else process.env.PRISMA_POOL_TIMEOUT = prevTimeout;
  if (prevUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevUrl;
});
