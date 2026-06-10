import { useEffect, useState } from "react";
import clsx from "clsx";
import { brandAssetUrl } from "@/lib/brandingAssets";

type OrganizationSidebarLogoProps = {
  organizationLogoUrl: string | null;
  brandingReady: boolean;
  alt: string;
  className?: string;
  /** Logo maior e destacado (menu recolhido). */
  emphasized?: boolean;
};

export function OrganizationSidebarLogo({
  organizationLogoUrl,
  brandingReady,
  alt,
  className,
  emphasized = false,
}: OrganizationSidebarLogoProps) {
  const systemLogo = brandAssetUrl("/logo.svg");
  const targetSrc = brandingReady ? (organizationLogoUrl ?? systemLogo) : null;

  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!targetSrc) {
      setVisible(false);
      setDisplaySrc(null);
      return;
    }

    let cancelled = false;
    setVisible(false);

    const img = new Image();
    const reveal = () => {
      if (cancelled) return;
      setDisplaySrc(targetSrc);
      requestAnimationFrame(() => {
        if (!cancelled) setVisible(true);
      });
    };

    img.onload = reveal;
    img.onerror = () => {
      if (cancelled || targetSrc === systemLogo) return;
      const fallback = new Image();
      fallback.onload = () => {
        if (cancelled) return;
        setDisplaySrc(systemLogo);
        requestAnimationFrame(() => {
          if (!cancelled) setVisible(true);
        });
      };
      fallback.onerror = reveal;
      fallback.src = systemLogo;
    };
    img.src = targetSrc;

    return () => {
      cancelled = true;
    };
  }, [targetSrc, systemLogo]);

  const sizeClass = emphasized ? "h-11 w-11 max-w-[2.75rem]" : "h-9 w-auto max-w-[2.75rem]";

  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center",
        emphasized ? "h-11 w-11" : "h-9 w-[2.75rem]",
        className,
      )}
      aria-hidden={!displaySrc}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          className={clsx(
            sizeClass,
            "object-contain transition-opacity duration-300 ease-out",
            visible ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
        />
      ) : null}
    </span>
  );
}
