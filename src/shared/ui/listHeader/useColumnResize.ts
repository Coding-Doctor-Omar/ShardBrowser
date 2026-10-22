import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { layoutRect, pageZoom } from "@proxyshard/shardx-ui-kit";
import { clampWidth, columnVar, type ColumnsApi } from "../../lib/tableColumns";

/// Dragging a column's edge (owner feature 2026-09-26). While the pointer
/// moves, only a custom property on the list changes (`--col-<id>`, which
/// the grid template falls back from), so the header and every row follow
/// without a React render; the width is stored once, when the pointer lets
/// go. Esc or a cancelled pointer puts it back. The width stays inside the
/// column's own minimum and maximum.
export function useColumnResize<Id extends string>({ api, listRef, wrapRef }: {
  api: ColumnsApi<Id>;
  listRef: React.RefObject<HTMLElement | null>;
  wrapRef: React.RefObject<HTMLElement | null>;
}) {
  // A gesture that loses its element (the edge unmounts mid-resize: the
  // column it belongs to hides, the list's section is left) never gets a
  // pointerup: `lostpointercapture` and this unmount cleanup both end it
  // (fix round 1 item 4), so `html[data-column-gesture]` cannot stick.
  const endRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endRef.current?.(), []);

  return useCallback((e: React.PointerEvent<HTMLElement>, id: Id) => {
    const def = api.defs.find((d) => d.id === id);
    const list = listRef.current;
    const wrap = wrapRef.current;
    const cell = e.currentTarget.closest<HTMLElement>("[data-col]");
    if (e.button !== 0 || !def || !list || !wrap || !cell) return;
    // The edge's press is not the title's drag.
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const pointer = e.pointerId;
    const x0 = e.clientX;
    // Layout px: under Interface size (CSS zoom) the pointer converts by the
    // page zoom and the cell's rect by its own scale (older WebKit reports
    // rects zoom-adjusted and the pointer not).
    const z = pageZoom();
    const from = layoutRect(cell).width;
    const minBefore = wrap.style.minWidth;
    let width = from;
    handle.setPointerCapture(pointer);
    document.documentElement.dataset.columnGesture = "resize";
    const onMove = (ev: PointerEvent) => {
      width = clampWidth(def, from + (ev.clientX - x0) / z);
      list.style.setProperty(columnVar(id), `${width}px`);
      // The list's minimum grows with the column: it scrolls, never squeezes.
      wrap.style.minWidth = `calc(${minBefore || "0px"} + ${Math.max(0, width - from)}px)`;
    };
    const end = (keep: boolean) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      handle.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("keydown", onKey, true);
      endRef.current = null;
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      delete document.documentElement.dataset.columnGesture;
      wrap.style.minWidth = minBefore;
      // Rendered before the live width goes, so no frame shows the old one.
      // A press that barely moved (a double click's) stores nothing.
      if (keep && Math.abs(width - from) >= 1) flushSync(() => api.setWidth(id, width));
      list.style.removeProperty(columnVar(id));
    };
    const onUp = () => end(true);
    // A cancelled pointer, or one that loses capture without ever letting go
    // (its element unmounted underneath it): both abandon the resize.
    const onCancel = () => end(false);
    // Esc drops the resize, and only the resize: the list's own Esc never hears it.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    handle.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("keydown", onKey, true);
    endRef.current = () => end(false);
  }, [api, listRef, wrapRef]);
}
