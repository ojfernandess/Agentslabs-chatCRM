/** Versão injetada no build Docker (`ARG VITE_PUBLIC_ASSETS_VERSION`) para forçar novo fetch da logo e outros estáticos de marca. */
export function brandAssetUrl(path: string): string {
  const raw = import.meta.env.VITE_PUBLIC_ASSETS_VERSION as string | undefined;
  const v = typeof raw === "string" && raw.trim() ? raw.trim() : "";
  if (!v) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}v=${encodeURIComponent(v)}`;
}

/** Logo do sistema em fundos escuros (rodapé, sidebar super admin). */
export const systemLogoOnDarkBgClass = "brightness-0 invert";

/** Logo do sistema quando a app está em modo escuro. */
export const systemLogoDarkModeClass = "dark:brightness-0 dark:invert";
