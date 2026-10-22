import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "../../../shared/model/toast";
import { reportLoadError } from "../../../shared/model/loadError";
import { deferDelete, isPendingDelete } from "../../../shared/lib/deferDelete";
import { storeBus } from "../../../shared/lib/storeBus";
import { t } from "../../../shared/i18n";
import { extensionDelete, extensionImport, extensionImportUrl, extensionList } from "../model/api";
import { extensionLinkAllowed, normalizeExtensionLink } from "../model/link";
import { extensionName } from "../model/name";
import type { ExtensionEntry } from "../model/types";

// An extension removed behind its Undo toast stays out of every read until the toast goes.
const living = (items: ExtensionEntry[]) => items.filter((x) => !isPendingDelete(`extension:${x.id}`));

export type ExtensionStore = {
  status: "idle" | "loading" | "ready" | "error";
  /** Why the first load failed. */
  error: string | null;
  items: ExtensionEntry[];
  busy: boolean;
  search: string;
  /// The "paste a link" dialog.
  linkOpen: boolean;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  setSearch: (q: string) => void;
  setLinkOpen: (open: boolean) => void;
  importUrl: (url: string) => Promise<void>;
  importFiles: () => Promise<void>;
  importFolder: () => Promise<void>;
  remove: (e: ExtensionEntry) => Promise<void>;
};

export const useExtensions = create<ExtensionStore>((set, get) => ({
  status: "idle",
  error: null,
  items: [],
  busy: false,
  search: "",
  linkOpen: false,

  init: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      set({ items: living(await extensionList()), status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
      reportLoadError("extensions", t("useExtensions.loadFailed"), e);
    }
  },
  reload: async () => {
    try {
      set({ items: living(await extensionList()) });
      storeBus.emit("extensions");
    } catch (e) { toast.fail({ title: t("useExtensions.refreshFailed"), detail: e }); }
  },
  setSearch: (search) => set({ search }),
  setLinkOpen: (linkOpen) => set({ linkOpen }),

  importUrl: async (url) => {
    const link = normalizeExtensionLink(url);
    if (!link) return;
    // A bare id or a parsed https URL only, whoever calls (SEC-08; the
    // backend should refuse anything else too, B8).
    if (!extensionLinkAllowed(link)) { toast.err(t("extensions.linkHttp")); return; }
    set({ busy: true });
    try {
      const added = await extensionImportUrl(link);
      await get().reload();
      set({ linkOpen: false });
      toast.ok(t("useExtensions.addedNamed", { name: extensionName(added) }));
    } catch (e) { toast.fail({ title: t("useExtensions.downloadFailed"), detail: e }); }
    finally { set({ busy: false }); }
  },

  importFiles: async () => {
    const picked = await open({
      multiple: true,
      title: t("useExtensions.pickFilesTitle"),
      filters: [{ name: t("useExtensions.fileFilter"), extensions: ["crx", "zip"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    set({ busy: true });
    try {
      const added = await extensionImport(paths as string[]);
      await get().reload();
      toast.ok(added.length === 1
        ? t("useExtensions.addedCountOne", { n: added.length })
        : t("useExtensions.addedCountMany", { n: added.length }));
    } catch (e) { toast.fail({ title: t("useExtensions.importFilesFailed"), detail: e }); }
    finally { set({ busy: false }); }
  },

  importFolder: async () => {
    const dir = await open({ directory: true, title: t("useExtensions.pickFolderTitle") });
    if (typeof dir !== "string") return;
    set({ busy: true });
    try {
      const added = await extensionImport([dir]);
      await get().reload();
      toast.ok(added.length > 0
        ? t("useExtensions.addedFolderNamed", { name: extensionName(added[0]) })
        : t("useExtensions.nothingAdded"));
    } catch (e) { toast.fail({ title: t("useExtensions.importFolderFailed"), detail: e }); }
    finally { set({ busy: false }); }
  },

  // Behind an Undo toast, nothing asked (ruling 18).
  remove: async (e) => {
    // The name as a card shows it, never a path.
    const name = extensionName(e);
    deferDelete({
      key: `extension:${e.id}`,
      title: t("useExtensions.removed", { name }),
      failTitle: t("useExtensions.removeFailed", { name }),
      hide: () => set({ items: get().items.filter((x) => x.id !== e.id) }),
      restore: () => void get().reload(),
      commit: async () => { await extensionDelete(e.id); await get().reload(); },
    });
  },
}));
