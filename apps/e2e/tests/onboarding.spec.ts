import { expect, headerCredits, newOwner, openSection, test } from "./fixtures.js";

test("a new owner gets a stable, starting credits and a starter horse", async ({ page }) => {
  await newOwner(page);
  expect(await headerCredits(page)).toBe(5000);
  // The daily first-race bonus is advertised until it is earned, with a way to the races.
  await expect(page.getByText(/First race of the day pays a 100 cr bonus/)).toBeVisible();
  await page.getByRole("link", { name: "Go racing" }).click();
  await expect(page).toHaveURL(/\/races\/$/);
  await page.getByRole("link", { name: "Horses" }).click();
  await expect(page.getByText(/1 \/ 3 boxes used/)).toBeVisible();
  await expect(page.locator("a[href^='/horse/?id=']")).toHaveCount(1);
  await openSection(page, "Facilities");
  await expect(page.getByText("Needs stable level 2")).toHaveCount(2);
});

test("a signed-in session survives a reload", async ({ page }) => {
  await newOwner(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Career path" })).toBeVisible();
});
