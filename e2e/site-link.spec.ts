import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";

// The product site: Settings → About and the palette link to it, each with its own utm_content.
const SITE = "https://shardbrowser.com/?utm_source=launcher&utm_medium=app&utm_campaign=shardbrowser&utm_content=";
type Mock = { __shardxMock: { log: { cmd: string; args: Record<string, unknown> }[] } };
const opened = (page: Page) => page.evaluate(() =>
  (window as unknown as Mock).__shardxMock.log.filter((l) => l.cmd === "plugin:opener|open_url").map((l) => l.args.url));
const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });

// The mock opens a link with window.open: no popup in a test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
});

test("About has a Website row whose link opens shardbrowser.com in the system browser", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "About" }).click();
  const row = page.locator("[data-details='about'] [data-detail='website']");
  await expect(row).toContainText("Website");
  const link = row.getByRole("link", { name: "shardbrowser.com", exact: true });
  await expect(link).toHaveAttribute("href", `${SITE}settings_about`);
  await link.click();
  await expect.poll(() => opened(page)).toEqual([`${SITE}settings_about`]);
  // Opened outside, not in the launcher's own window.
  expect(new URL(page.url()).host).not.toBe("shardbrowser.com");
});

test("the palette opens shardbrowser.com, found by “website”", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  await palette(page).getByRole("combobox", { name: "Search commands" }).fill("website");
  await palette(page).getByRole("option", { name: /^Open shardbrowser\.com/ }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => opened(page)).toEqual([`${SITE}palette`]);
});

test("in Russian the row is Сайт and the palette finds the site by «сайт»", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.evaluate(() => localStorage.setItem("shardx.lang", "ru"));
  await reloadApp(page);
  await page.getByRole("tab", { name: "О программе" }).click();
  await expect(page.locator("[data-details='about'] [data-detail='website']")).toContainText("Сайт");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").getByRole("combobox").fill("сайт");
  await expect(page.getByRole("dialog").getByRole("option", { name: /^Открыть сайт shardbrowser\.com/ })).toBeVisible();
});
