/** Extract a YouTube video id from common watch, embed, and short URLs. */
export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return id || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }
      const embedMatch = /^\/embed\/([^/?]+)/.exec(parsed.pathname);
      if (embedMatch) return embedMatch[1];
      const shortsMatch = /^\/shorts\/([^/?]+)/.exec(parsed.pathname);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    return null;
  }
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  return extractYouTubeVideoId(url) != null;
}

export function getYouTubeEmbedUrl(url: string): string | null {
  const id = extractYouTubeVideoId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}
