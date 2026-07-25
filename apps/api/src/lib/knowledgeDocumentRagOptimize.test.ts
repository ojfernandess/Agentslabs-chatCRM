import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDocumentRagReadiness,
  extractFactFingerprints,
  validateFactPreservation,
} from "./knowledgeDocumentRagOptimize.js";

const SAMPLE = `# Hotel X

## WiFi
- **Rede:** NET_X
- **Senha:** secret99

## Quartos
### Standard
- 12 m² · 1 hóspede
`;

test("extractFactFingerprints captures key-value and headers", () => {
  const fps = extractFactFingerprints(SAMPLE);
  assert.ok(fps.some((f) => f.includes("NET_X")));
  assert.ok(fps.some((f) => f.includes("wifi")));
});

test("validateFactPreservation passes when facts kept", () => {
  const after = `# Hotel X\n\n## WiFi / Internet\n- **Rede:** NET_X\n- **Senha:** secret99\n\n## Quartos\n### Standard\n- 12 m² · 1 hóspede`;
  const v = validateFactPreservation(SAMPLE, after);
  assert.equal(v.ok, true);
});

test("validateFactPreservation fails when SSID removed", () => {
  const after = `# Hotel X\n\n## WiFi\n- Contact reception for password`;
  const v = validateFactPreservation(SAMPLE, after);
  assert.equal(v.ok, false);
  assert.ok(v.missing.length > 0);
});

test("analyzeDocumentRagReadiness reports sections", () => {
  const a = analyzeDocumentRagReadiness(SAMPLE);
  assert.equal(a.hasSections, true);
  assert.ok(a.sectionCount >= 2);
  assert.ok(a.estimatedChunks >= 2);
});
