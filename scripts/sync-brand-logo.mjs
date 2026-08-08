import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

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

let copied = 0;
for (const dest of targets) {
  if (dest === src) continue;
  const dir = dirname(dest);
  // No Docker do web, apps/website não é copiado — saltar destinos sem pasta.
  if (!existsSync(dir)) {
    console.warn(`sync-brand-logo: a saltar ${dest} (diretório em falta)`);
    continue;
  }
  copyFileSync(src, dest);
  copied += 1;
}

console.log(`sync-brand-logo: ${src} → ${copied} destinos`);
