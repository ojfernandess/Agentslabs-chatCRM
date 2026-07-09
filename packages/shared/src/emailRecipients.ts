/** Utilitários partilhados para destinatários de e-mail (To / Cc / Cco). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Separa por vírgula, ponto-e-vírgula ou espaço; normaliza e deduplica. */
export function parseEmailAddressList(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => String(v).split(/[,;\s]+/))
    : String(raw ?? "").split(/[,;\s]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const email = part.trim().toLowerCase();
    if (!email || !isValidEmailAddress(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function formatEmailAddressList(emails: string[]): string {
  return emails.join(", ");
}
