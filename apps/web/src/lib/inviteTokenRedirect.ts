/** Redireciona URLs legadas com `?token=` para `/invite` antes do router React montar. */
export function redirectLegacyInviteUrls(): void {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token")?.trim();
    if (!token) return;

    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/invite" || path === "/login/invite") return;

    if (path === "/login" || path === "/" || path === "") {
      url.pathname = "/invite";
      window.location.replace(url.toString());
    }
  } catch {
    /* ignore */
  }
}

export function readInviteTokenFromLocation(searchParams: URLSearchParams): string {
  const fromParams = searchParams.get("token")?.trim();
  if (fromParams) return fromParams;
  try {
    return new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}
