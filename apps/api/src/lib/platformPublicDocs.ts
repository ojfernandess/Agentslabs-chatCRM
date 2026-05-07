import { prisma } from "../db.js";

/** Chave em `platform_settings`; valor JSON boolean `true` para expor `/api/v1/public/system-documentation`. */
export const PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY = "public_system_documentation_enabled";

export function parsePublicSystemDocumentationEnabled(raw: unknown): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  if (typeof raw === "object" && raw !== null && "enabled" in raw) {
    return Boolean((raw as { enabled?: unknown }).enabled);
  }
  return false;
}

export async function isPublicSystemDocumentationEnabled(): Promise<boolean> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY },
    select: { value: true },
  });
  if (!row) return false;
  return parsePublicSystemDocumentationEnabled(row.value);
}
