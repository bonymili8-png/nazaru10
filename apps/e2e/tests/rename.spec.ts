import { expect, newOwner, test } from "./fixtures.js";

test("renaming checks for Latin letters and costs gems", async ({ page }) => {
  await newOwner(page);
  await page.goto("/horses/");
  await page.getByRole("button", { name: "Rename stable" }).click();
  const input = page.getByLabel("New name");
  await input.fill("Зоряна стайня");
  await expect(page.getByText("Use Latin letters only (A–Z).")).toBeVisible();
  await expect(page.getByRole("button", { name: /Rename · 80 gems/ })).toBeDisabled();

  await input.fill("Star Stable");
  await expect(page.getByRole("button", { name: /Rename · 80 gems/ })).toBeEnabled();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /Rename · 80 gems/ }).click();
  // A new owner has no gems.
  await expect(page.getByText("Not enough gems.")).toBeVisible();

  await page.locator("a[href^='/horse/?id=']").first().click();
  await page.getByRole("button", { name: "Rename horse" }).click();
  await expect(page.getByRole("button", { name: /Rename · 50 gems/ })).toBeVisible();
});
