import { create } from "zustand";
import { toast } from "../../../shared/model/toast";
import { reportLoadError } from "../../../shared/model/loadError";
import { deferDelete, isPendingDelete } from "../../../shared/lib/deferDelete";
import { t } from "../../../shared/i18n";
import { bookmarkDelete, bookmarkList, bookmarkSave } from "../model/api";
import type { Bookmark } from "../model/types";
import { bookmarkName } from "./name";

// A bookmark deleted behind its Undo toast stays out of every read until the toast goes.
const living = (items: Bookmark[]) => items.filter((x) => !isPendingDelete(`bookmark:${x.id}`));

export const emptyBookmark = (folder = ""): Bookmark => ({
  id: "",
  title: "",
  url: "",
  folder,
});

export type BookmarkStore = {
  status: "idle" | "loading" | "ready" | "error";
  /** Why the first load failed. */
  error: string | null;
  items: Bookmark[];
  /** Open editor, or null. */
  editing: Bookmark | null;
  search: string;
  /** Folder tab; "all" shows everything. */
  folder: string;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  setEditing: (b: Bookmark | null) => void;
  setSearch: (q: string) => void;
  setFolder: (f: string) => void;
  save: (b: Bookmark) => Promise<void>;
  remove: (b: Bookmark) => Promise<void>;
};

export const useBookmarks = create<BookmarkStore>((set, get) => ({
  status: "idle",
  error: null,
  items: [],
  editing: null,
  search: "",
  folder: "all",

  init: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      set({ items: living(await bookmarkList()), status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
      reportLoadError("bookmarks", t("useBookmarks.loadFailed"), e);
    }
  },
  reload: async () => {
    try { set({ items: living(await bookmarkList()) }); }
    catch (e) { toast.fail({ title: t("useBookmarks.refreshFailed"), detail: e }); }
  },
  setEditing: (editing) => set({ editing }),
  setSearch: (search) => set({ search }),
  setFolder: (folder) => set({ folder }),

  save: async (b) => {
    const name = bookmarkName(b);
    try {
      await bookmarkSave(b);
      set({ editing: null });
      await get().reload();
      toast.saved(t("useBookmarks.saved", { name }));
    } catch (e) {
      toast.fail({ title: t("useBookmarks.saveFailed", { name }), detail: e, subject: name });
    }
  },

  // Behind an Undo toast, nothing asked (ruling 18).
  remove: async (b) => {
    const name = bookmarkName(b);
    deferDelete({
      key: `bookmark:${b.id}`,
      title: t("useBookmarks.deleted", { name }),
      failTitle: t("useBookmarks.deleteFailed", { name }),
      hide: () => set({ items: get().items.filter((x) => x.id !== b.id) }),
      restore: () => void get().reload(),
      commit: async () => { await bookmarkDelete(b.id); await get().reload(); },
    });
  },
}));
