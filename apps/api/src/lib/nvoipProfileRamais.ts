/** Ramais numéricos salvos no perfil, estáveis para comparar com o destino do DID. */
export function normalizeProfileRamais(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const ramais: string[] = [];
  for (const value of values) {
    for (const part of value.split(/[,;\s]+/)) {
      const digits = part.replace(/\D/g, "");
      if (digits.length < 3 || digits.length > 16 || seen.has(digits)) continue;
      seen.add(digits);
      ramais.push(digits);
    }
  }
  ramais.sort();
  return ramais;
}

export function buildProfileDidDestination(ramais: Iterable<string>): string | null {
  const list = normalizeProfileRamais(ramais);
  return list.length > 0 ? list.join(",") : null;
}

/** DID que já toca em ramais. URA, IP e URL ficam como estão. */
export function shouldRouteDidToProfileRamais(destination: string | null | undefined): boolean {
  const raw = destination?.trim() ?? "";
  if (!raw) return false;
  const parts = raw.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => /^\d{3,16}$/.test(part));
}

export function didDestinationMatches(current: string | null | undefined, next: string): boolean {
  return normalizeProfileRamais([current ?? ""]).join(",") === normalizeProfileRamais([next]).join(",");
}
