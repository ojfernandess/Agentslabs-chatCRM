import clsx from "clsx";
import { brandAssetUrl } from "@/lib/brandingAssets";

type Props = {
  alt?: string;
  className?: string;
};

/** Logo de marca — mix-blend remove fundo branco do PNG embutido no SVG em modo escuro. */
export function BrandLogo({ alt = "", className }: Props) {
  return (
    <img
      src={brandAssetUrl("/logo.svg")}
      alt={alt}
      decoding="async"
      className={clsx(
        "brand-logo-img h-9 w-auto max-w-[132px] object-contain object-left",
        className,
      )}
    />
  );
}
