import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, reloadApp, row, waitForIdle } from "./support/app";
import { boxOf } from "./support/geometry";

// The top of All profiles (the owner's redesign, 2026-10-01): Continue, the
// profiles used last, and Problems to fix, a card for each problem only while it
// is true. Each section folds under its heading, as the sidebar's groups do.

type Mock = {
  __shardxMock: {
    state: {
      running: Record<string, unknown>;
      profiles: Record<string, { timezone: string; _meta: { proxy_id: string | null; last_launched_at: string | null } }>;
    };
    save: () => void;
  };
};
const overview = (page: Page) => page.locator("[data-overview]");
const tiles = (page: Page) => overview(page).locator("[data-continue-tile]");
const tile = (page: Page, id: string) => overview(page).locator(`[data-continue-tile='${id}']`);
const card = (page: Page, kind: string) => overview(page).locator(`[data-problem-card='${kind}']`);
const section = (page: Page, name: "continue" | "needs") => overview(page).locator(`[data-overview-section='${name}']`);
const heading = (page: Page, name: RegExp) => overview(page).getByRole("button", { name });
const tileIds = (page: Page) => tiles(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-continue-tile")));
const nav = (page: Page, section: string) => page.locator(`aside [data-nav='${section}']`).click();
const GB = 1024 ** 3;

const EBAY = "9828bf28";
const AMAZON = "a78a0eea";
const SCRAPER = "e51f8c32";
const FB01 = "c31d92f0";
const ETSY = "aed41005";

test("Continue shows the five profiles used last, running first, each with its status in words and one Start or Stop", async ({ page }) => {
  await openApp(page);
  expect(await tileIds(page)).toEqual([EBAY, AMAZON, SCRAPER, FB01, ETSY]);
  await expect(tile(page, EBAY).locator("[data-tile-status]")).toHaveText("Running, 27 min");
  await expect(tile(page, AMAZON).locator("[data-tile-status]")).toHaveText("Running, 2 h");
  await expect(tile(page, SCRAPER).locator("[data-tile-status]")).toHaveText("2 h ago");
  await expect(tile(page, FB01).locator("[data-tile-status]")).toHaveText("Yesterday");
  await expect(tile(page, ETSY).locator("[data-tile-status]")).toHaveText("2 days ago");
  // The Running dot has its halo and never breathes; the others have no dot.
  await expect(tile(page, EBAY).locator("[data-halo]")).toHaveCount(1);
  await expect(overview(page).locator(".animate-breathe")).toHaveCount(0);
  await expect(tile(page, SCRAPER).locator("[data-halo]")).toHaveCount(0);
  await expect(tile(page, EBAY).getByRole("button", { name: "Stop eBay DE buyer" })).toBeVisible();
  // One row of five at 1280, each a 24 px button.
  const ys = new Set<number>();
  for (const id of [EBAY, AMAZON, SCRAPER, FB01, ETSY]) ys.add(Math.round((await boxOf(tile(page, id))).y));
  expect(ys.size).toBe(1);
  expect(Math.round((await boxOf(tile(page, SCRAPER).getByRole("button", { name: "Start Scraper pricing" }))).height)).toBe(24);
  // No icon swatch: the name starts at the tile's inner edge, as far in as the tile's right inset.
  for (const id of [EBAY, AMAZON, SCRAPER, FB01, ETSY]) {
    await expect(tile(page, id).locator("[data-swatch]")).toHaveCount(0);
    const t = await boxOf(tile(page, id));
    const name = await boxOf(tile(page, id).locator("[data-tile-main] span.truncate").first());
    expect(Math.round(name.x - t.x)).toBeLessThanOrEqual(12);
  }
});

test("a tile's button starts its profile, and the row holds its order while the pointer or the keyboard is in it", async ({ page }) => {
  await openApp(page);
  await tile(page, SCRAPER).getByRole("button", { name: "Start Scraper pricing" }).click();
  await expect(tile(page, SCRAPER).locator("[data-tile-status]")).toHaveText("Running, 1 min");
  await expect(tile(page, SCRAPER).getByRole("button", { name: "Stop Scraper pricing" })).toBeVisible();
  // Started, it is in use now, but it stays where the hand is.
  expect(await tileIds(page)).toEqual([EBAY, AMAZON, SCRAPER, FB01, ETSY]);
  await page.mouse.move(2, 400);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => tileIds(page)).toEqual([SCRAPER, EBAY, AMAZON, FB01, ETSY]);
});

test("a click on a tile opens that profile in Peek, and Enter on its name does the same", async ({ page }) => {
  await openApp(page);
  await tile(page, FB01).locator("[data-tile-status]").click();
  await expect(page.locator("aside[data-peek]")).toHaveAttribute("aria-label", "Peek: FB Ads acc-01");
  // Beside Peek the row shows what fits: three tiles at 1280.
  await expect(tiles(page)).toHaveCount(3);
  await tile(page, SCRAPER).locator("[data-tile-main]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("aside[data-peek]")).toHaveAttribute("aria-label", "Peek: Scraper pricing");
});

// Review I1: exactly 5, 3 or 1 columns, by the list column's own width (at
// 900 and 520 px; a pushing Peek counts, the test above); with fewer tiles
// than columns a tile keeps its column's width and never stretches.
test("Continue takes 5, 3 or 1 columns by the list column's width, and a tile never stretches", async ({ page }) => {
  await openApp(page);
  const grid = overview(page).getByRole("list").first();
  const shape = () => grid.evaluate((el) => ({
    column: el.closest<HTMLElement>("[data-overview]")!.offsetWidth,
    columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
  }));
  for (const [viewport, columns, least, under] of [[1280, 5, 900, Infinity], [1024, 3, 520, 900], [760, 1, 0, 520]] as const) {
    await page.setViewportSize({ width: viewport, height: 800 });
    await expect.poll(async () => (await shape()).columns, `columns at ${viewport}`).toBe(columns);
    await expect(tiles(page)).toHaveCount(columns);
    const { column } = await shape();
    expect(column, `list column at ${viewport}`).toBeGreaterThanOrEqual(least);
    expect(column, `list column at ${viewport}`).toBeLessThan(under);
  }
  // Three profiles used, five columns: each tile a fifth of the row.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    for (const p of Object.values(m.state.profiles)) p._meta.last_launched_at = null;
    for (const [i, id] of ["aed41005", "c31d92f0", "e51f8c32"].entries()) {
      m.state.profiles[id]._meta.last_launched_at = `@${Math.floor(Date.now() / 1000) - 3600 * (i + 1)}`;
    }
    m.state.running = {};
    m.save();
  });
  await reloadApp(page);
  await expect(tiles(page)).toHaveCount(3);
  const { row, gap, tile: width } = await grid.evaluate((el) => ({
    row: el.getBoundingClientRect().width,
    gap: parseFloat(getComputedStyle(el).columnGap),
    tile: el.querySelector("[role='listitem']")!.getBoundingClientRect().width,
  }));
  expect(Math.abs(width - (row - 4 * gap) / 5)).toBeLessThanOrEqual(1);
});

test("with fewer than two profiles ever used Continue shows its hint in place of the tiles", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    for (const p of Object.values(m.state.profiles)) p._meta.last_launched_at = null;
    m.state.profiles["aed41005"]._meta.last_launched_at = `@${Math.floor(Date.now() / 1000) - 3600}`;
    m.state.running = {};
    m.save();
  });
  await reloadApp(page);
  await expect(row(page, "Etsy craft shop")).toBeVisible();
  await expect(section(page, "continue")).toBeVisible();
  await expect(overview(page).locator("[data-continue-hint]")).toHaveText("Profiles you start show up here.");
  await expect(tiles(page)).toHaveCount(0);
});

test("Location leak: the profiles on no proxy first, and a click shows exactly the profiles it names, under a chip", async ({ page }) => {
  await openApp(page);
  const leak = card(page, "locationLeak");
  await expect(leak.locator("[data-card-main]")).toHaveText("Location leak");
  await expect(leak.getByText("2 profiles", { exact: true })).toBeVisible();
  // The pill counts both profiles; the sentence says how many of them are on the real IP.
  await expect(leak.locator("p").first()).toHaveText("1 of 2 profiles starts on your real IP");
  await expect(leak.locator("[data-card-detail]")).toHaveText("No proxy: Sandbox");
  await expect(leak.locator("[data-card-more]")).toHaveText("1 more");
  await leak.click({ position: { x: 40, y: 60 } });
  await expect(page.getByText("Problem: Location leak")).toBeVisible();
  const names = await page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
  expect(names.map((n) => n.trim()).sort()).toEqual(["FB Ads acc-02", "Sandbox"]);
});

test("Location leak: the sentence's count agrees with the pill when every profile on the card is on no proxy", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  // FB Ads acc-02 loses its proxy too: two profiles on the card, both on the real IP.
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    m.state.profiles["c31d92f1"]._meta.proxy_id = null;
    m.save();
  });
  await reloadApp(page);
  await nav(page, "profiles");
  const leak = card(page, "locationLeak");
  await expect(leak.getByText("2 profiles", { exact: true })).toBeVisible();
  await expect(leak.locator("p").first()).toHaveText("2 profiles start on your real IP");
  await expect(leak.locator("[data-card-more]")).toHaveCount(0);
});

test("Assign proxy opens the Assign dialog for the profiles on no proxy, and the selection stays", async ({ page }) => {
  await openApp(page);
  // At rest a row's box shows on hover only (selection mode, Lane C).
  await row(page, "Etsy craft shop").hover();
  await row(page, "Etsy craft shop").getByRole("checkbox").click();
  await card(page, "locationLeak").getByRole("button", { name: "Assign proxy" }).click();
  await expect(page.getByRole("dialog", { name: "Assign a proxy" })).toBeVisible();
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  type P = { __profile: { useProfileUi: { getState: () => { assign: { ids: string[] } | null; selected: Set<string> } } } };
  expect(await page.evaluate(() => (window as unknown as P).__profile.useProfileUi.getState().assign?.ids)).toEqual(["f62a9d43"]);
  expect(await page.evaluate(() => [...(window as unknown as P).__profile.useProfileUi.getState().selected])).toEqual([ETSY]);
});

test("Location leak (b): a hand-set timezone on another country's IP; Match proxy gives it back to the proxy", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  // Sandbox gets a proxy, so only FB Ads acc-02's New York time on Tokyo's IP is left.
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    m.state.profiles["f62a9d43"]._meta.proxy_id = "px-us-2";
    m.save();
  });
  await reloadApp(page);
  await nav(page, "profiles");
  const leak = card(page, "locationLeak");
  await expect(leak).toContainText("Timezone doesn’t match the proxy’s country");
  await expect(leak.locator("[data-card-detail]")).toHaveText("FB Ads acc-02: US time on Japanese IP");
  await expect(leak.locator("[data-card-more]")).toHaveCount(0);
  await leak.getByRole("button", { name: "Match proxy" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("FB Ads acc-02 now takes its timezone and language from its proxy")).toBeVisible();
  await expect(leak).toHaveCount(0);
  // With nothing wrong, Problems to fix is not there at all.
  await expect(section(page, "needs")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as Mock).__shardxMock.state.profiles["c31d92f1"].timezone)).toBe("auto");
});

test("Proxy balance: a plan under 15 % says how long it lasts, shows its usage, and Top up opens the dialog", async ({ page }) => {
  await page.addInitScript((gb) => {
    (window as unknown as { __shardxMockTraffic: unknown }).__shardxMockTraffic = { premium: { data: 10 * gb, data_remain: 1.2 * gb, data_spent: 8.8 * gb, proxy_password: "" } };
  }, GB);
  await openApp(page);
  const balance = card(page, "proxyBalance");
  await expect(balance.getByText("1.2 GB left")).toBeVisible();
  await expect(balance).toContainText("Premium residential runs out in about a day");
  // A residential plan has no end to print (owner, 2026-10-07: Lifetime).
  await expect(balance.locator("[data-card-usage]")).toHaveText(/^8\.8 of 10 GB used$/);
  await expect(balance).not.toContainText("Ends");
  await expect(balance.locator("[data-card-more]")).toHaveText("2 profiles use it");
  // Money comes after an account at risk.
  expect(await overview(page).locator("[data-problem-card]").evaluateAll((els) => els.map((el) => el.getAttribute("data-problem-card")))).toEqual(["locationLeak", "proxyBalance"]);
  await balance.getByRole("button", { name: "Top up" }).click();
  await expect(page.getByRole("dialog", { name: "Buy traffic" })).toBeVisible();
});

// Review I3: a plan changed elsewhere does not stay wrong for days. The plans
// are read again when the window comes back (at most every five minutes) and
// right after a top-up here; the card changes in place, the list stays put.
test("Proxy balance follows its plan: read again on focus after five minutes and after a top-up, in place", async ({ page }) => {
  const traffic = (remain: number) => ({ premium: { data: 10 * GB, data_remain: remain * GB, data_spent: (10 - remain) * GB, proxy_password: "" } });
  await page.addInitScript((t) => { (window as unknown as { __shardxMockTraffic: unknown }).__shardxMockTraffic = t; }, traffic(1.2));
  await openApp(page);
  const balance = card(page, "proxyBalance");
  await expect(balance.getByText("1.2 GB left")).toBeVisible();
  const first = row(page, "Amazon US seller");
  const y = (await boxOf(first)).y;
  const setTraffic = (remain: number) => page.evaluate((t) => { (window as unknown as { __shardxMockTraffic: unknown }).__shardxMockTraffic = t; }, traffic(remain));
  const reads = () => page.evaluate(() => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls.ps_profile_traffic ?? 0);
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));

  // Back within five minutes: no read.
  await setTraffic(1.1);
  const before = await reads();
  await focus();
  await waitForIdle(page);
  expect(await reads()).toBe(before);
  // Six minutes on: read again, and the card says so in place.
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(now + 6 * 60_000);
  await focus();
  await expect(balance.getByText("1.1 GB left")).toBeVisible();
  expect((await boxOf(first)).y).toBe(y);

  // A top-up here: read again at once.
  await setTraffic(1.4);
  await balance.getByRole("button", { name: "Top up" }).click();
  const dialog = page.getByRole("dialog", { name: "Buy traffic" });
  await dialog.getByRole("button", { name: "Buy 5 GB" }).click();
  await expect(dialog).toBeHidden();
  await expect(balance.getByText("1.4 GB left")).toBeVisible();
  expect((await boxOf(first)).y).toBe(y);
});

test("Failed today: a start that fails says why in words, with Try again; the tile says Failed to start", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockLaunchFails: string[] }).__shardxMockLaunchFails = ["aed41005"]; });
  await openApp(page);
  await tile(page, ETSY).getByRole("button", { name: "Start Etsy craft shop" }).click();
  const failed = card(page, "failedToday");
  await expect(failed).toContainText("Etsy craft shop didn’t start: its port was in use");
  await expect(failed.locator("[data-card-detail]")).toHaveText(/^Last try 12:00\sPM$/);
  await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(tile(page, ETSY).locator("[data-tile-status]")).toHaveText("Failed to start");
});

test("a hidden card stays hidden after a restart, and with nothing else wrong Problems to fix goes", async ({ page }) => {
  await openApp(page);
  const leak = card(page, "locationLeak");
  await leak.hover();
  await leak.getByRole("button", { name: "Hide" }).click();
  await expect(leak).toHaveCount(0);
  await expect(section(page, "needs")).toBeHidden();
  await reloadApp(page);
  await expect(section(page, "continue")).toBeVisible();
  await expect(card(page, "locationLeak")).toHaveCount(0);
});

test("each section folds under its heading, stays folded after a restart, and the palette lists only what applies", async ({ page }) => {
  await openApp(page);
  const cont = heading(page, /^Continue$/);
  await expect(cont).toHaveAttribute("aria-expanded", "true");
  await cont.click();
  await expect(cont).toHaveAttribute("aria-expanded", "false");
  await expect(tiles(page).first()).toBeHidden();
  const needs = heading(page, /^Problems to fix/);
  await needs.click();
  // Folded: how many, and the account at risk in words.
  await expect(needs).toHaveText(/^Problems to fix\s*1\s*Location leak$/);
  await expect(card(page, "locationLeak")).toBeHidden();
  await reloadApp(page);
  await expect(heading(page, /^Continue$/)).toHaveAttribute("aria-expanded", "false");
  await expect(heading(page, /^Problems to fix/)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Continue");
  const options = page.getByRole("dialog", { name: "Command palette" }).getByRole("option");
  await expect(options.filter({ hasText: "Unfold “Continue”" })).toHaveCount(1);
  await expect(options.filter({ hasText: /^Fold “Continue”/ })).toHaveCount(0);
  await options.filter({ hasText: "Unfold “Continue”" }).click();
  await expect(heading(page, /^Continue$/)).toHaveAttribute("aria-expanded", "true");
  await expect(tiles(page).first()).toBeVisible();
});

test("the list's first paint has the overview's room: rows never move while the cards' reads come in; Reduce motion folds at once", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { proxy_last_test: 600 }; });
  await openApp(page, { idle: false });
  const first = row(page, "Amazon US seller");
  await expect(first).toBeVisible();
  const y = (await boxOf(first)).y;
  // FB Ads acc-02's timezone joins the leak card once the tests are read.
  await expect(card(page, "locationLeak").locator("[data-card-more]")).toHaveText("1 more");
  expect((await boxOf(first)).y).toBe(y);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const moves = await overview(page).locator(".overview-fold").first().evaluate((el) => getComputedStyle(el).transitionProperty);
  expect(moves).not.toContain("height");
});

test("in a short window (1024 x 680 at 150%) Continue shows folded, Problems to fix and the saved fold stay, and a hand unfold holds until the window grows", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.interfaceSize", "150"));
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  const cont = heading(page, /^Continue$/);
  await expect(cont).toHaveAttribute("aria-expanded", "false");
  await expect(tiles(page).first()).toBeHidden();
  await expect(heading(page, /^Problems to fix/)).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("shardx.profiles.layout") ?? "{}").folded?.continue ?? false)).toBe(false);
  // Opened by hand, it stays open while the window is short, and after it grows.
  await cont.click();
  await expect(cont).toHaveAttribute("aria-expanded", "true");
  await expect(tiles(page).first()).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 1400 });
  await expect(cont).toHaveAttribute("aria-expanded", "true");
  await expect(tiles(page).first()).toBeVisible();
});

test("in a short window the first paint never holds Continue's room: the first row's top is the same at the first frame and settled (1024 x 680 at 150%)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.interfaceSize", "150"));
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  await expect(heading(page, /^Continue$/)).toHaveAttribute("aria-expanded", "false");
  // A restart: the kept room and the kept verdict are the first paint's.
  await page.addInitScript(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { proxy_last_test: 600 }; });
  await page.reload();
  const first = row(page, "Amazon US seller");
  await expect(first).toBeVisible();
  const y = (await boxOf(first)).y;
  await expect(card(page, "locationLeak").locator("[data-card-more]")).toHaveText("1 more");
  expect((await boxOf(first)).y).toBe(y);
});
