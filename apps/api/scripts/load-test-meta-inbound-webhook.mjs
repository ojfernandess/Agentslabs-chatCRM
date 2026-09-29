#!/usr/bin/env node
/**
 * Teste de carga leve — webhook Meta inbound (early 200 + fila).
 *
 * Uso:
 *   node scripts/load-test-meta-inbound-webhook.mjs \
 *     --url http://localhost:3000/webhooks/whatsapp/<orgId>/<inboxId> \
 *     --phone-number-id <meta_phone_number_id> \
 *     --rps 10 --duration 30
 *
 * Requer META_INBOUND_QUEUE_ENABLED=true e Redis/worker operacionais para medir fila.
 * Cada mensagem usa wamid único (dedupe Redis).
 */

import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const out = {
    url: "",
    phoneNumberId: "",
    rps: 5,
    durationSec: 20,
    from: "5511999999999",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") out.url = argv[++i] ?? "";
    else if (a === "--phone-number-id") out.phoneNumberId = argv[++i] ?? "";
    else if (a === "--rps") out.rps = Number(argv[++i] ?? 5);
    else if (a === "--duration") out.durationSec = Number(argv[++i] ?? 20);
    else if (a === "--from") out.from = argv[++i] ?? out.from;
  }
  return out;
}

function buildPayload({ phoneNumberId, from }) {
  const wamid = `wamid.loadtest.${randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "load-test-entry",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: phoneNumberId,
              },
              contacts: [{ profile: { name: "Load Test" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: wamid,
                  timestamp: ts,
                  type: "text",
                  text: { body: `load test ${wamid.slice(-8)}` },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

const args = parseArgs(process.argv);
if (!args.url || !args.phoneNumberId) {
  console.error(
    "Missing --url and --phone-number-id. Example:\n" +
      "  node scripts/load-test-meta-inbound-webhook.mjs " +
      "--url http://localhost:3000/webhooks/whatsapp/ORG/INBOX --phone-number-id 123456",
  );
  process.exit(1);
}

const latencies = [];
let ok = 0;
let err = 0;
const endAt = Date.now() + args.durationSec * 1000;
const intervalMs = Math.max(1, Math.floor(1000 / args.rps));

console.log(
  `Load test: ${args.rps} rps for ${args.durationSec}s → ${args.url} (phone_number_id=${args.phoneNumberId})`,
);

while (Date.now() < endAt) {
  const started = performance.now();
  const body = buildPayload({ phoneNumberId: args.phoneNumberId, from: args.from });
  try {
    const res = await fetch(args.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = performance.now() - started;
    latencies.push(ms);
    if (res.ok) ok += 1;
    else {
      err += 1;
      console.warn(`HTTP ${res.status} in ${ms.toFixed(1)}ms`);
    }
  } catch (e) {
    err += 1;
    console.warn("fetch failed:", e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}

latencies.sort((a, b) => a - b);
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
const p99 = percentile(latencies, 99);

console.log("\n--- Results ---");
console.log(`requests: ${ok + err} (ok=${ok}, err=${err})`);
console.log(`latency ms: p50=${p50?.toFixed(1)} p95=${p95?.toFixed(1)} p99=${p99?.toFixed(1)} max=${latencies.at(-1)?.toFixed(1)}`);
console.log("\nNext: GET /api/v1/super/message-processing/dashboard → productionSlo.metaWebhookHttpP95Ms");
console.log("      docker compose logs worker | grep 'meta inbound queue'");
