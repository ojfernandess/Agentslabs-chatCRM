import { useEffect, useState } from "react";

/** Observa a classe `dark` no `<html>` (tema light/dark/system). */
export function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setIsDark(el.classList.contains("dark"));
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("openconduit:theme-changed", sync);
    return () => {
      obs.disconnect();
      window.removeEventListener("openconduit:theme-changed", sync);
    };
  }, []);

  return isDark;
}
