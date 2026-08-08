import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function stripWhiteBackgroundRects(svg) {
  return svg.replace(/<rect[^>]*fill="#ffffff"[^>]*\/>/gi, "");
}

const sources = [join(root, "automation/logo.svg"), join(root, "logo.svg")];
const srcPath = sources.find((p) => existsSync(p));
if (!srcPath) {
  console.error("fix-logo: logo.svg não encontrado em automation/ nem na raiz");
  process.exit(1);
}

let svg = readFileSync(srcPath, "utf8");
const before = (svg.match(/<rect[^>]*fill="#ffffff"[^>]*\/>/gi) || []).length;
svg = stripWhiteBackgroundRects(svg);
const after = (svg.match(/<rect[^>]*fill="#ffffff"[^>]*\/>/gi) || []).length;

writeFileSync(srcPath, svg);
console.log("logo.svg: removed", before - after, "white rects");

const targets = [
  join(root, "logo.svg"),
  join(root, "apps/web/public/logo.svg"),
  join(root, "apps/website/public/logo.svg"),
];
for (const dest of targets) {
  copyFileSync(srcPath, dest);
  console.log("copied to", dest);
}
