import { assertHttpUrlAllowed } from "./httpToolTest.js";

const DEFAULT_MAX_REDIRECTS = 3;

/**
 * HTTP fetch with SSRF guards: validates each URL (including redirects) against private hosts.
 */
export async function secureHttpFetch(
  rawUrl: string,
  init?: RequestInit & { maxRedirects?: number },
): Promise<Response> {
  const maxRedirects = init?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let url = assertHttpUrlAllowed(rawUrl);
  let redirects = 0;

  while (true) {
    const { maxRedirects: _ignored, ...fetchInit } = init ?? {};
    const res = await fetch(url.toString(), {
      ...fetchInit,
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location?.trim() || redirects >= maxRedirects) {
        throw new Error("Redirect blocked or too many redirects");
      }
      url = assertHttpUrlAllowed(new URL(location.trim(), url).toString());
      redirects += 1;
      continue;
    }

    return res;
  }
}
