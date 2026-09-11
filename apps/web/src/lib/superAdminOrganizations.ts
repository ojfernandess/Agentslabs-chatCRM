export type SuperAdminOrgOption = {
  id: string;
  name: string;
  slug?: string;
};

/** Normaliza GET /super/organizations (array ou { organizations }). */
export function parseSuperAdminOrgList(raw: unknown): SuperAdminOrgOption[] {
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (o): o is Record<string, unknown> =>
          typeof o === "object" && o !== null && "id" in o && "name" in o,
      )
      .map((o) => ({
        id: String(o.id),
        name: String(o.name),
        slug: typeof o.slug === "string" ? o.slug : undefined,
      }));
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "organizations" in raw &&
    Array.isArray((raw as { organizations: unknown }).organizations)
  ) {
    return parseSuperAdminOrgList((raw as { organizations: unknown }).organizations);
  }

  return [];
}
