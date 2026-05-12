/** Versão injetada no build Docker (`ARG VITE_PUBLIC_ASSETS_VERSION`) para forçar novo fetch da logo e outros estáticos de marca. */
export function brandAssetUrl(path: string): string {
  const raw = import.meta.env.VITE_PUBLIC_ASSETS_VERSION as string | undefined;
  const v = typeof raw === "string" && raw.trim() ? raw.trim() : "";
  if (!v) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}v=${encodeURIComponent(v)}`;
}
