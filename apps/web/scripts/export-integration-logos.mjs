import * as si from "simple-icons";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, "../public/integrations");
fs.mkdirSync(dir, { recursive: true });

function writeIcon(icon, file) {
  if (!icon?.path) return false;
  const svg =
    `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${icon.title}</title>` +
    `<path d="${icon.path}" fill="#${icon.hex}"/></svg>`;
  fs.writeFileSync(path.join(dir, file), svg);
  return true;
}

const slugs = [
  "anthropic",
  "caldotcom",
  "elevenlabs",
  "chatwoot",
  "gmail",
  "googlecalendar",
  "googlesheets",
  "mailgun",
  "mysql",
  "postgresql",
  "redis",
  "resend",
  "whatsapp",
  "discord",
  "mercadopago",
  "stripe",
  "n8n",
  "zapier",
  "make",
];

for (const slug of slugs) {
  const icon = Object.values(si).find((i) => i && typeof i === "object" && i.slug === slug);
  if (writeIcon(icon, `${slug}.svg`)) {
    console.log("ok", slug);
  }
}
