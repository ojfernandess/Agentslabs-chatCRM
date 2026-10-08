import { prisma } from "../db.js";

const RINGTONE_IDS = ["classic", "bright", "soft", "pulse", "bell", "digital", "chime", "urgent"] as const;

export type OrgSipRingtone = (typeof RINGTONE_IDS)[number];

export type OrgSipServerConfig = {
  sipDomain: string;
  wssUrl: string;
  ringTone: OrgSipRingtone;
};

function settingKey(organizationId: string): string {
  return `org_sip_server:${organizationId}`;
}

function cleanDomain(value: string): string {
  return value
    .trim()
    .replace(/^sips?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

export function normalizeOrgSipRingtone(value: unknown): OrgSipRingtone {
  return RINGTONE_IDS.includes(value as OrgSipRingtone) ? (value as OrgSipRingtone) : "classic";
}

export function parseOrgSipServer(value: unknown): OrgSipServerConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sipDomain = cleanDomain(typeof row.sipDomain === "string" ? row.sipDomain : "");
  const wssUrl = typeof row.wssUrl === "string" ? row.wssUrl.trim().replace(/\/+$/, "") : "";
  if (!sipDomain || !wssUrl.toLowerCase().startsWith("wss://")) return null;
  return { sipDomain, wssUrl, ringTone: normalizeOrgSipRingtone(row.ringTone) };
}

export async function getOrgSipServer(organizationId: string): Promise<OrgSipServerConfig | null> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: settingKey(organizationId) },
    select: { value: true },
  });
  return parseOrgSipServer(row?.value);
}

export async function saveOrgSipServer(
  organizationId: string,
  input: { sipDomain: string; wssUrl: string; ringTone?: string },
): Promise<OrgSipServerConfig> {
  const current = await getOrgSipServer(organizationId);
  const parsed = parseOrgSipServer({
    sipDomain: input.sipDomain,
    wssUrl: input.wssUrl,
    ringTone: input.ringTone ?? current?.ringTone ?? "classic",
  });
  if (!parsed) throw new Error("sip_server_invalid");
  await prisma.platformSetting.upsert({
    where: { key: settingKey(organizationId) },
    create: { key: settingKey(organizationId), value: parsed },
    update: { value: parsed },
  });
  return parsed;
}
