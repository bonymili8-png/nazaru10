import { expect, headerCredits, newOwner, test } from "./fixtures.js";

test("a new owner gets a stable, starting credits and a starter horse", async ({ page }) => {
  await newOwner(page);
  expect(await headerCredits(page)).toBe(5000);
  await page.getByRole("link", { name: "Horses" }).click();
  await expect(page.getByText(/1 \/ 3 boxes used/)).toBeVisible();
  await expect(page.locator("a[href^='/horse/?id=']")).toHaveCount(1);
});

test("a signed-in session survives a reload", async ({ page }) => {
  await newOwner(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Career path" })).toBeVisible();
});
