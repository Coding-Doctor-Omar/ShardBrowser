import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, DataList, DialogModal, EmptyState, Input, Tooltip } from "@proxyshard/shardx-ui-kit";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { AddExtensionMenu } from "../../features/manage-extensions";
import { useStoreChanged } from "../../shared/hooks/useStoreChanged";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { useArrivedIds } from "../../shared/hooks/useArrivedIds";
import { AddIcon, NavExtensionsIcon, SearchIcon } from "../../shared/icons";
import { LoadError, LoadingCards } from "../../shared/ui/ListStates";
import { rowActionIcons } from "../../shared/ui/rowActionIcons";
import { extensionKey, extensionLinkAllowed, extensionName, iconSrc, installCounts, isStoreLink, normalizeExtensionLink, useExtensions, type ExtensionEntry } from "../../entities/extension";
import { fmtBytes } from "../../shared/lib/format";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { useT } from "../../shared/i18n";
import { useScrollMemory } from "../../shared/model/scrollMemory";
import { refocusPageFilter } from "../../shared/lib/focus";
import { showMeAround } from "../../features/tour";

/** `copies`: how many times this name and version is installed (1 when once). */
function ExtensionCard({ e, copies }: { e: ExtensionEntry; copies: number }) {
  const t = useT();
  const src = iconSrc(e.icon);
  const name = extensionName(e);
  return (
    // Content on its own element: an article. The grid item around it is the
    // tile (the kit DataList's) and what takes focus; Remove is in its menu (CRAFT-03).
    // It fills its grid cell and its description takes the room left, so
    // every card in a row is as tall and their bottoms line up (UI-39).
    // min-w-0: the card is never wider than its cell, whatever its text; the
    // name is cut and the description wraps inside it.
    <article className="flex h-full w-full min-w-0 flex-col gap-2.5 rounded-tile px-cell py-[10px]">
      <div className="flex min-w-0 items-start gap-2.5">
        {src ? (
          <img src={src} alt="" className="size-[35px] shrink-0 rounded-control object-contain outline outline-1 -outline-offset-1 outline-stroke-image" />
        ) : (
          <div className="grid size-[35px] shrink-0 place-items-center rounded-control bg-bg-on-tile text-icon-sub-600">
            <NavExtensionsIcon className="size-3.5" />
          </div>
        )}
        {/* pe-5: room for the card's More button (top right, on hover), so it never sits on the name. */}
        <div className="min-w-0 flex-1 pe-5">
          {/* The whole name on hover, only when it is cut. */}
          <Tooltip content={name} whenTruncated><h2 className="m-0 truncate text-secondary font-medium text-text-strong-950">{name}</h2></Tooltip>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary text-text-soft-400">
            <span className="truncate">{e.version ? `v${e.version}, ${fmtBytes(e.size_bytes)}` : fmtBytes(e.size_bytes)}</span>
            {/* The same extension twice: each card says so and keeps its own Remove. */}
            {copies > 1 && (
              <Badge size="small" color="warning" className="shrink-0">
                {copies === 2 ? t("extensions.installedTwice") : t("extensions.installedTimes", { n: copies })}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <p className="m-0 line-clamp-2 min-h-[2.4em] flex-1 break-words text-secondary text-text-sub-600">
        {e.description || <span className="text-text-soft-400">{t("extensions.noDescription")}</span>}
      </p>
    </article>
  );
}

/** Add by address: a Web Store page, a bare id, or a .crx / .zip link. */
function LinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const busy = useExtensions((s) => s.busy);
  const importUrl = useExtensions((s) => s.importUrl);
  // Trimmed of every Unicode whitespace character, not just what JS's own
  // `trim()` removes: the backend's Rust `trim()` strips more (e.g. U+0085
  // NEL), so a link that hides its real scheme behind it must be judged the
  // way the backend will actually see it, not the way JS shows it (SEC-08).
  const link = normalizeExtensionLink(url);
  // A parsed https URL or a bare id only; a plain-http file can be swapped on
  // the way, and anything else is not a scheme this app downloads through.
  const allowed = link !== "" && extensionLinkAllowed(link);
  const disallowed = link !== "" && !allowed;
  // Allowed, but not a known Web Store address: unknown author, and it can
  // read every page of the profiles it goes into (SEC-08).
  const offStore = allowed && !isStoreLink(link);
  return (
    <DialogModal
      open={open}
      onClose={onClose}
      // The link typed in: Esc, the close button and Cancel ask before dropping it.
      dirty={url !== ""}
      title={t("extensions.linkTitle")}
      confirmLabel={busy ? t("extensions.downloading") : t("extensions.download")}
      onConfirm={() => importUrl(link)}
      isLoading={busy}
      isDisabled={busy || !link || !allowed}
      cancelLabel={t("extensions.cancel")}
      onCancel={onClose}
    >
      <div className="flex w-full flex-col gap-3 py-4">
        <Input
          label={t("extensions.linkFieldLabel")}
          inputSize="xsmall"
          className="mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://chromewebstore.google.com/detail/…"
          error={disallowed ? t("extensions.linkHttp") : undefined}
          hint={offStore ? t("extensions.linkOffStore") : undefined}
        />
        <p className="m-0 text-secondary text-text-soft-400">{t("extensions.linkHelp")}</p>
      </div>
    </DialogModal>
  );
}

export function ExtensionsPage() {
  const t = useT();
  // The grid scrolls itself; it keeps its place across page switches (WIG-06).
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollMemory(scrollRef, "extensions");
  const init = useExtensions((s) => s.init);
  const items = useExtensions((s) => s.items);
  const status = useExtensions((s) => s.status);
  const loadError = useExtensions((s) => s.error);
  const search = useExtensions((s) => s.search);
  const setSearch = useExtensions((s) => s.setSearch);
  const linkOpen = useExtensions((s) => s.linkOpen);
  const setLinkOpen = useExtensions((s) => s.setLinkOpen);
  // Stays mounted through its exit (FEEL-01).
  const linkLife = useDialogLife(linkOpen);

  const reload = useExtensions((s) => s.reload);
  useEffect(() => { init(); }, [init]);
  // Pick up extensions added through the automation API.
  useStoreChanged(reload);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (e) => extensionName(e).toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [items, search]);
  // Counted over every extension, not the search: two copies stay two while one is filtered out.
  const counts = useMemo(() => installCounts(items), [items]);

  const remove = useExtensions((s) => s.remove);
  const loading = useHeldLoading(status === "idle" || status === "loading");
  // Nothing to count or filter yet (LAYOUT-20).
  const empty = status === "ready" && items.length === 0;
  // A query hidden with the field would come back with the first extension.
  useEffect(() => { if (empty) setSearch(""); }, [empty, setSearch]);
  // An added extension (a link, a file, a folder, the API) slides in once.
  const arrived = useArrivedIds(items.map((e) => e.id), status === "ready");

  const emptyState = items.length > 0 && search.trim() ? (
    <EmptyState
      icon={<SearchIcon />}
      title={t("extensions.noMatchTitle", { q: search.trim() })}
      actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={() => { setSearch(""); refocusPageFilter(); }}>{t("listStates.clearSearch")}</Button>}
    />
  ) : (
    <EmptyState icon={<NavExtensionsIcon />} title={t("extensions.emptyTitle")} hint={t("extensions.emptyHelp")} action={{ label: t("extensions.emptyAction"), icon: <AddIcon />, onClick: () => setLinkOpen(true) }} />
  );

  return (
    <>
      <PageHeader
        title={t("extensions.title")}
        count={!loading && status === "ready" && !empty ? shown.length : undefined}
        help={{ title: t("pageHelp.extensions.title"), body: t("pageHelp.extensions.body"), onTour: () => showMeAround("extensions") }}
        filter={empty ? undefined : { value: search, onChange: setSearch }}
        actions={<AddExtensionMenu />}
      />
      {/* The grid scrolls itself; the page does not. The list recipe's card
          grid (F5, IFACE-11): one Tab stop, arrows move by what is beside,
          above and below, Remove in a card's menu and on the Delete key (it
          asks first). The states center in the same tile a table sits on. */}
      <PageBody scroll={false}>
        <DataList<ExtensionEntry>
          variant="grid"
          // Wide enough for a name and its version on a line (a narrower card cuts both).
          minCardWidth={280}
          scrollRef={scrollRef}
          aria-label={t("extensions.title")}
          items={shown}
          getId={(e) => e.id}
          getName={extensionName}
          labels={{ selectAll: t("dataList.selectAll"), select: (name) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions") }}
          status={loading ? "loading" : status === "error" ? "error" : "ready"}
          loading={<LoadingCards />}
          error={<LoadError what={t("listStates.extensions")} error={loadError} onRetry={() => void init()} />}
          empty={emptyState}
          arrived={arrived}
          renderCard={(e) => <ExtensionCard e={e} copies={counts.get(extensionKey(e)) ?? 1} />}
          onDelete={(ids) => {
            for (const id of ids) {
              const e = items.find((x) => x.id === id);
              if (e) void remove(e);
            }
          }}
          menuItems={(e) => [
            { label: t("extensions.removeItem"), icon: rowActionIcons.trash({ className: "size-3.5" }), danger: true, onSelect: () => void remove(e) },
          ]}
        />
      </PageBody>

      {linkLife.mounted && <LinkDialog key={linkLife.session} open={linkOpen} onClose={() => setLinkOpen(false)} />}
    </>
  );
}
