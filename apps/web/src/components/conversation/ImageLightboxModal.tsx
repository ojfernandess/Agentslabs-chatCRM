import { Download, X } from "lucide-react";
import { motion } from "@/components/Motion";
import { brandAssetUrl, systemLogoOnDarkBgClass } from "@/lib/brandingAssets";

export function ImageLightboxModal({
  src,
  downloadLabel,
  closeLabel,
  onClose,
}: {
  src: string;
  downloadLabel: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-[80] flex flex-col bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
        <img
          src={brandAssetUrl("/logo.svg")}
          alt="OpenNexo"
          className={`h-8 w-auto max-w-[9rem] object-contain object-left ${systemLogoOnDarkBgClass}`}
        />
        <div className="flex items-center gap-2">
          <a
            href={src}
            download
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
          >
            <Download className="h-4 w-4" />
            {downloadLabel}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" onClick={onClose}>
        <img
          src={src}
          alt=""
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </motion.div>
  );
}
