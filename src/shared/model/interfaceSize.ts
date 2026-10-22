import { create } from "zustand";

const KEY = "shardx.interfaceSize";

/** Settings > Appearance > Interface size (O15). 100 is the default. */
export const INTERFACE_SIZES = [90, 100, 110, 125, 150] as const;
export type InterfaceSize = (typeof INTERFACE_SIZES)[number];

function readStored(): InterfaceSize {
  try {
    const n = Number(localStorage.getItem(KEY));
    return (INTERFACE_SIZES as readonly number[]).includes(n) ? (n as InterfaceSize) : 100;
  } catch {
    return 100;
  }
}

/** CSS zoom on <html>; --page-zoom lets viewport-relative sizes stay true. */
function apply(size: InterfaceSize) {
  const root = document.documentElement;
  if (size === 100) {
    root.style.removeProperty("zoom");
    root.style.removeProperty("--page-zoom");
  } else {
    root.style.setProperty("zoom", String(size / 100));
    root.style.setProperty("--page-zoom", String(size / 100));
  }
}

/** What is stored, whatever is shown. */
let saved = readStored();
export const savedInterfaceSize = (): InterfaceSize => saved;

/// The UI's size in this window. Kept in this window's storage, like Reduce
/// motion: a property of the screen the launcher is on, not of the backend.
/// `previewSize` shows a choice without storing it (Settings, until Save).
export const useInterfaceSize = create<{
  size: InterfaceSize;
  setSize: (size: InterfaceSize) => void;
  previewSize: (size: InterfaceSize) => void;
}>((set) => ({
  size: saved,
  setSize: (size) => {
    try { localStorage.setItem(KEY, String(size)); } catch { /* private mode: applies until reload */ }
    saved = size;
    apply(size);
    set({ size });
  },
  previewSize: (size) => {
    apply(size);
    set({ size });
  },
}));

/** Applies the stored size; run once at startup, in the main window only. */
export function applyStoredInterfaceSize() {
  apply(useInterfaceSize.getState().size);
}
