/** Papel vindo da API / JWT — normaliza para comparação segura. */
export function normalizeRole(role: unknown): string {
  if (role == null) return "";
  return String(role).trim().toUpperCase();
}

export function isSuperAdminRole(role: unknown): boolean {
  return normalizeRole(role) === "SUPER_ADMIN";
}

/** Admin do tenant: ADMIN da org ou super admin a impersonar uma organização. */
export function isTenantAdmin(role: unknown, actingOrganizationId?: string | null): boolean {
  const r = normalizeRole(role);
  if (r === "ADMIN") return true;
  if (r === "SUPER_ADMIN" && actingOrganizationId) return true;
  return false;
}
