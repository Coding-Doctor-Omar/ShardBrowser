import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { axeViolations } from "./support/axe";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek]");

// The kit Select as an APG select-only combobox (audit Phase C, Tasks 18 and 19).

test("P then the arrows, a typed name and Enter bind a proxy, all from the keyboard", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  if (await peek(page).count()) await page.keyboard.press("Escape");
  await row(page, "Sandbox").focus();
  await page.keyboard.press("p");
  // The picker is a search field over the list (Task 18): the field has the keys at once.
  const field = page.getByRole("dialog", { name: /Proxy/ }).getByRole("combobox", { name: "Proxy", exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  // Typing filters the list and highlights the first match.
  await page.keyboard.type("DC To");
  await expect(page.getByRole("option", { name: /DC Tokyo/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  // The cell names the proxy (F7, Task 17).
  await expect(row(page, "Sandbox").locator("[data-cell='proxy']")).toContainText("DC Tokyo");
});

test("Settings: the language Select works with the arrows and keeps focus", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const field = page.getByRole("combobox", { name: /language/i });
  await field.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(field).toBeFocused();
});

test("an open Select passes axe's list rules", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("combobox", { name: /language/i }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  const violations = await axeViolations(page, {
    rules: ["aria-required-children", "aria-required-parent", "listitem", "aria-input-field-name", "aria-valid-attr-value", "aria-allowed-role"],
  });
  expect(violations).toEqual([]);
});

// Pair 25 review, Important 2: a searchable Select's search field hands focus
// back to the field by script, which :focus-visible carries over; after a
// mouse pick the field must not draw the keyboard ring, after a keyboard pick
// it must. F19 took the Filters popover's Selects away; the residential
// generator's Country is a searchable Select on every run.
/** The field draws the keyboard focus ring. */
const ringShown = (field: Locator) =>
  field.evaluate((el) => el.matches(":focus-visible") && getComputedStyle(el).outlineStyle !== "none");

test("a searchable Select shows the focus ring after a keyboard pick, never after a mouse pick", async ({ page }) => {
  await openApp(page, { section: "proxyshard" });
  // The plan is the Residential tile's ghost menu (Residential as the third top tile).
  await page.getByRole("button", { name: "Residential plan" }).click();
  await page.getByRole("menuitemradio", { name: "Premium" }).click();
  await page.getByRole("button", { name: "Generate proxies" }).click();
  const field = page.getByRole("dialog", { name: "Generate Premium residential proxies" }).getByRole("combobox", { name: "Country", exact: true });
  await field.click();
  await page.getByRole("dialog", { name: "Country", exact: true }).getByRole("option", { name: /Germany/ }).click();
  await expect(field).toBeFocused();
  expect(await ringShown(field), "after a mouse pick").toBe(false);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("dialog", { name: "Country", exact: true })).toBeVisible();
  await page.keyboard.type("japan");
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await expect(field).toContainText("Japan");
  expect(await ringShown(field), "after a keyboard pick").toBe(true);
});

// Pair 25 review, Important 1: a combobox takes no name from its text, so
// every Select needs a label; the residential generator's two had none.
test("the residential generator's Selects have names (axe)", async ({ page }) => {
  await openApp(page, { section: "proxyshard" });
  // The plan is the Residential tile's ghost menu (Residential as the third top tile).
  await page.getByRole("button", { name: "Residential plan" }).click();
  await page.getByRole("menuitemradio", { name: "Premium" }).click();
  await page.getByRole("button", { name: "Generate proxies" }).click();
  const dialog = page.getByRole("dialog", { name: "Generate Premium residential proxies" });
  await dialog.getByRole("button", { name: "Advanced settings" }).click();
  await expect(dialog.getByRole("combobox", { name: "Operating system", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Session mode", exact: true })).toBeVisible();
  expect(await axeViolations(page, { include: "[role='dialog']", rules: ["aria-input-field-name"] })).toEqual([]);
});
