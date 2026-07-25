import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDocumentRagReadiness,
  extractFactFingerprintGroups,
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
  assert.ok(fps.some((f) => f.toLowerCase().includes("wifi")));
});

test("extractFactFingerprintGroups splits critical values and soft headers", () => {
  const groups = extractFactFingerprintGroups(SAMPLE);
  assert.ok(groups.critical.some((f) => f.includes("NET_X")));
  assert.ok(groups.critical.some((f) => f.includes("secret99")));
  assert.ok(groups.soft.some((f) => f.includes("wifi")));
});

test("validateFactPreservation passes when facts kept with renamed headers", () => {
  const after = `# Hotel X\n\n## WiFi / Internet\n- **Rede:** NET_X\n- **Senha:** secret99\n\n## Quartos / Acomodações\n### Standard\n- 12 m² · 1 hóspede`;
  const v = validateFactPreservation(SAMPLE, after);
  assert.equal(v.ok, true);
});

test("validateFactPreservation passes when bullets reformatted but values kept", () => {
  const before = `# Hotel\n\n## WiFi\n- **Rede:** Viva Rock Ocean\n- **Senha:** @@vivapp\n\n## Quartos\n- Standard 12m2\n- Superior 18m2`;
  const after = `# Hotel\n\n## WiFi / Internet\n- Rede: Viva Rock Ocean\n- Senha: @@vivapp\n\n## Categorias de quartos\n### Standard\n- 12 m²\n### Superior\n- 18 m²`;
  const v = validateFactPreservation(before, after);
  assert.equal(v.ok, true);
});

test("validateFactPreservation fails when SSID removed", () => {
  const after = `# Hotel X\n\n## WiFi\n- Contact reception for password`;
  const v = validateFactPreservation(SAMPLE, after);
  assert.equal(v.ok, false);
  assert.ok(v.missing.length > 0);
});

test("validateFactPreservation tolerates soft header renames on large docs", () => {
  const after = `# Hotel X\n\n## Internet / WiFi\n- **Rede:** NET_X\n- **Senha:** secret99\n\n## Acomodações\n### Standard\n- capacidade 1 hóspede`;
  const v = validateFactPreservation(SAMPLE, after);
  assert.equal(v.ok, true);
});

test("analyzeDocumentRagReadiness reports sections", () => {
  const a = analyzeDocumentRagReadiness(SAMPLE);
  assert.equal(a.hasSections, true);
  assert.ok(a.sectionCount >= 2);
  assert.ok(a.estimatedChunks >= 2);
});
