import { useEffect, useRef, useState, type ReactElement } from "react";
import { ResponsiveContainer, type ResponsiveContainerProps } from "recharts";

type Props = Omit<ResponsiveContainerProps, "width" | "height"> & {
  className?: string;
  minHeight?: number;
  children: ReactElement;
};

/**
 * Evita aviso do Recharts (width/height -1) quando o contentor ainda não tem dimensões
 * (ex.: animações Framer Motion ou tabs ocultas).
 */
export function MeasuredResponsiveContainer({
  className,
  minHeight = 256,
  children,
  ...rest
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width > 0 && height > 0) {
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ minHeight, minWidth: 0, width: "100%" }}>
      {size.width > 0 && size.height > 0 ? (
        <ResponsiveContainer width={size.width} height={size.height} minWidth={0} {...rest}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
