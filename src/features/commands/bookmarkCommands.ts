import { t } from "../../shared/i18n";
import { AddIcon } from "../../shared/icons";
import { useNav } from "../../shared/model/navigation";
import { defineCommands, type Command } from "../../shared/commands";
import { emptyBookmark, useBookmarks } from "../../entities/bookmark";

/// The Bookmarks page's commands. C is each page's New (IFACE-11): a
/// bookmark here, in the Folder the page shows.
export const BOOKMARK_COMMANDS: readonly Command[] = [
  {
    area: "bookmarks", page: "bookmarks", id: "bookmark.new", scope: "page", group: "create", icon: AddIcon,
    // It opens the editor, which takes the keyboard (PC-108).
    focusAfter: true,
    label: () => t("commands.newBookmark"), keys: ["C"], keyWhere: "page", singleKey: true,
    surfaces: ["palette", "sheet"],
    run: async () => {
      if (!(await useNav.getState().setSection("bookmarks"))) return;
      const { folder, setEditing } = useBookmarks.getState();
      setEditing(emptyBookmark(folder === "all" || folder === "__any__" ? "" : folder));
    },
  },
];

defineCommands(BOOKMARK_COMMANDS);
