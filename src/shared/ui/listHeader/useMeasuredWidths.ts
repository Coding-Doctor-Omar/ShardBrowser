import { useLayoutEffect, useState } from "react";
import { clientScale } from "@proxyshard/shardx-ui-kit";

/// Each column title's drawn width, layout px: a growing column has no stored
/// width until a person sets one, and its edge still needs `aria-valuenow`
/// and a start for its arrow keys.
export function useMeasuredWidths<Id extends string>(
  rowRef: React.RefObject<HTMLElement | null>,
  template: string,
): Partial<Record<Id, number>> {
  const [px, setPx] = useState<Partial<Record<Id, number>>>({});
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const read = () => {
      const next: Partial<Record<Id, number>> = {};
      const k = clientScale();
      row.querySelectorAll<HTMLElement>("[data-col]").forEach((el) => {
        next[el.dataset.col as Id] = Math.round(el.getBoundingClientRect().width / k);
      });
      setPx((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const ro = new ResizeObserver(read);
    ro.observe(row);
    row.querySelectorAll("[data-col]").forEach((el) => ro.observe(el));
    read();
    return () => ro.disconnect();
  }, [rowRef, template]);
  return px;
}
