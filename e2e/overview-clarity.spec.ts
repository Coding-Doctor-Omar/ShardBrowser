import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";

// The top of All profiles says what it is for (owner, 2026-10-07, item 8):
// "Problems to fix", each card with what is wrong, why it matters and one fix;
// shown on All profiles only; and Continue keeps its heading with a hint
// instead of vanishing when fewer than two profiles were started.

type Mock = {
  __shardxMock: {
    state: { running: Record<string, unknown>; profiles: Record<string, { _meta: { last_launched_at: string | null } }> };
    save: () => void;
  };
};
const GB = 1024 ** 3;
const overview = (page: Page) => page.locator("[data-overview]");
const card = (page: Page, kind: string) => overview(page).locator(`[data-problem-card='${kind}']`);
const heading = (page: Page, name: RegExp) => overview(page).getByRole("button", { name });

/** Nothing started yet, or only the Etsy profile, an hour ago. */
async function startedOnly(page: Page, ids: string[]) {
  await page.evaluate((used) => {
    const m = (window as unknown as Mock).__shardxMock;
    for (const p of Object.values(m.state.profiles)) p._meta.last_launched_at = null;
    for (const id of used) m.state.profiles[id]._meta.last_launched_at = `@${Math.floor(Date.now() / 1000) - 3600}`;
    m.state.running = {};
    m.save();
  }, ids);
  await reloadApp(page);
}

test("the section reads \"Problems to fix\", not \"Needs you\"", async ({ page }) => {
  await openApp(page);
  await expect(heading(page, /^Problems to fix/)).toBeVisible();
  await expect(overview(page).getByText("Needs you")).toHaveCount(0);
});

test("each card shows what is wrong, why it matters and one fix", async ({ page }) => {
  await page.addInitScript((gb) => {
    (window as unknown as { __shardxMockTraffic: unknown }).__shardxMockTraffic = { premium: { data: 10 * gb, data_remain: 1.2 * gb, data_spent: 8.8 * gb, proxy_password: "" } };
  }, GB);
  await openApp(page);
  const leak = card(page, "locationLeak");
  await expect(leak).toContainText("1 of 2 profiles starts on your real IP");
  await expect(leak.locator("[data-card-why]")).toHaveText("Sites can see your real IP and link your profiles to you.");
  await expect(leak.getByRole("button", { name: "Assign proxy" })).toHaveCount(1);
  const balance = card(page, "proxyBalance");
  await expect(balance).toContainText("Premium residential runs out in about a day");
  await expect(balance.locator("[data-card-why]")).toHaveText("Profiles on this plan stop loading pages when the traffic runs out.");
  await expect(balance.getByRole("button", { name: "Top up" })).toHaveCount(1);
  // Every card, whatever its kind: a title, a severity word, what, why and a fix.
  const cards = overview(page).locator("[data-problem-card]");
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  for (const c of await cards.all()) {
    await expect(c.locator("[data-card-main]")).not.toHaveText("");
    await expect(c.locator("[data-card-why]")).not.toHaveText("");
    await expect(c.locator("p").first()).not.toHaveText("");
    await expect(c.locator("button[data-card-action]")).toHaveCount(1);
  }
});

test("the cards and Continue show on All profiles only: not inside a view or a folder", async ({ page }) => {
  await openApp(page);
  await expect(card(page, "locationLeak")).toBeVisible();
  await expect(heading(page, /^Continue$/)).toBeVisible();
  await page.locator("aside [data-view='builtin:running']").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Running");
  await expect(page.locator("[data-overview]")).toHaveCount(0);
  await page.locator("aside [data-folder='Ads']").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ads");
  await expect(page.locator("[data-overview]")).toHaveCount(0);
  await page.locator("aside nav").getByText("All profiles", { exact: true }).click();
  await expect(card(page, "locationLeak")).toBeVisible();
  await expect(heading(page, /^Continue$/)).toBeVisible();
});

test("Continue keeps its heading and says where profiles will show up while fewer than two are started", async ({ page }) => {
  await openApp(page);
  await startedOnly(page, []);
  await expect(heading(page, /^Continue$/)).toHaveAttribute("aria-expanded", "true");
  await expect(overview(page).locator("[data-continue-hint]")).toHaveText("Profiles you start show up here.");
  await expect(overview(page).locator("[data-continue-tile]")).toHaveCount(0);
  // One started profile is still one: a row of one says nothing the list does not.
  await startedOnly(page, ["aed41005"]);
  await expect(heading(page, /^Continue$/)).toBeVisible();
  await expect(overview(page).locator("[data-continue-hint]")).toHaveText("Profiles you start show up here.");
  await expect(overview(page).locator("[data-continue-tile]")).toHaveCount(0);
  // Two started: the tiles take the hint's place.
  await startedOnly(page, ["aed41005", "c31d92f0"]);
  await expect(overview(page).locator("[data-continue-tile]")).toHaveCount(2);
  await expect(overview(page).locator("[data-continue-hint]")).toHaveCount(0);
});
