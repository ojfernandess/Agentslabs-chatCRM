import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

/** Fonte canónica da marca — automation/logo.svg tem prioridade. */
const sources = [join(root, "automation/logo.svg"), join(root, "logo.svg")];
const src = sources.find((p) => existsSync(p));

if (!src) {
  console.warn("sync-brand-logo: nenhum logo.svg encontrado (automation/ ou raiz)");
  process.exit(0);
}

const targets = [
  join(root, "logo.svg"),
  join(root, "apps/web/public/logo.svg"),
  join(root, "apps/website/public/logo.svg"),
];

for (const dest of targets) {
  copyFileSync(src, dest);
}

console.log(`sync-brand-logo: ${src} → ${targets.length} destinos`);
