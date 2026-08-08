import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function stripWhiteBackgroundRects(svg) {
  return svg.replace(/<rect[^>]*fill="#ffffff"[^>]*\/>/gi, "");
}

const src = join(root, "logo.svg");
let svg = readFileSync(src, "utf8");
const before = (svg.match(/<rect[^>]*fill="#ffffff"[^>]*\/>/gi) || []).length;
svg = stripWhiteBackgroundRects(svg);
const after = (svg.match(/<rect[^>]*fill="#ffffff"[^>]*\/>/gi) || []).length;

writeFileSync(src, svg);
console.log("logo.svg: removed", before - after, "white rects");

const targets = [
  join(root, "apps/web/public/logo.svg"),
  join(root, "apps/website/public/logo.svg"),
];
for (const dest of targets) {
  copyFileSync(src, dest);
  console.log("copied to", dest);
}
