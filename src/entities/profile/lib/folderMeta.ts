import { create } from "zustand";
import { FOLDER_ICON_GLYPHS } from "../../../shared/icons";
import { LABEL_COLORS, type LabelColorId } from "../../../shared/constants";
import { hasOwn } from "../../../shared/lib/utils";

export type FolderIcon = keyof typeof FOLDER_ICON_GLYPHS;
/** A Folder's look: a palette color id (or none) and an icon id. */
export type FolderMeta = { color: LabelColorId | null; icon: FolderIcon };

export const DEFAULT_FOLDER_META: FolderMeta = { color: null, icon: "folder" };

// Kept in this window's storage for now (owner decision, Phase 2C): the
// backend Folder list with color and icon is left to the devs.
const KEY = "shardx.folderMeta";

// The first build stored hex values; they map onto the palette's ids.
const LEGACY_HEX: Record<string, LabelColorId> = {
  "#3b82f6": "blue", "#724fff": "violet", "#e040c8": "magenta", "#f04438": "red",
  "#f97316": "orange", "#eab308": "yellow", "#12b76a": "green", "#0ba5ec": "sky",
};

/** Anything stored that isn't a known color or icon falls back to none / the folder. */
function normalise(raw: unknown): FolderMeta {
  const v = (raw && typeof raw === "object" ? raw : {}) as { color?: unknown; icon?: unknown };
  const color = typeof v.color === "string"
    ? (LABEL_COLORS.some((c) => c.id === v.color) ? (v.color as LabelColorId) : LEGACY_HEX[v.color.toLowerCase()] ?? null)
    : null;
  const icon = typeof v.icon === "string" && v.icon in FOLDER_ICON_GLYPHS ? (v.icon as FolderIcon) : "folder";
  return { color, icon };
}

function load(): Record<string, FolderMeta> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).map(([name, meta]) => [name, normalise(meta)]));
  } catch {
    return {};
  }
}

function save(byName: Record<string, FolderMeta>) {
  try { localStorage.setItem(KEY, JSON.stringify(byName)); } catch { /* private mode: until reload */ }
}

type FolderMetaState = {
  byName: Record<string, FolderMeta>;
  setMeta: (name: string, meta: FolderMeta) => void;
  /** Moves a Folder's look to its new name. */
  renameMeta: (from: string, to: string) => void;
  dropMeta: (name: string) => void;
};

export const useFolderMeta = create<FolderMetaState>((set, get) => ({
  byName: load(),
  setMeta: (name, meta) => {
    const byName = { ...get().byName, [name]: meta };
    save(byName);
    set({ byName });
  },
  renameMeta: (from, to) => {
    const byName = { ...get().byName };
    if (hasOwn(byName, from)) { byName[to] = byName[from]; delete byName[from]; }
    save(byName);
    set({ byName });
  },
  dropMeta: (name) => {
    const byName = { ...get().byName };
    delete byName[name];
    save(byName);
    set({ byName });
  },
}));

/** A Folder's look, or the default one. */
export function useFolderLook(name: string): FolderMeta {
  return useFolderMeta((s) => (hasOwn(s.byName, name) ? s.byName[name] : undefined)) ?? DEFAULT_FOLDER_META;
}

/** A Folder's stored look, or null when it has none (read before a delete, for its Undo). */
export function lookOf(name: string): FolderMeta | null {
  const byName = useFolderMeta.getState().byName;
  return hasOwn(byName, name) ? byName[name] : null;
}
