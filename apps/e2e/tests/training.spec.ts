import { expect, headerCredits, newOwner, openFirstHorse, test } from "./fixtures.js";

test("an owner trains a horse and pays for the session", async ({ page }) => {
  await newOwner(page);
  const before = await headerCredits(page);
  await openFirstHorse(page);
  await page.getByRole("tab", { name: "train" }).click();
  await page.getByRole("radio", { name: /Stamina/ }).click();
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.getByText("None — hire one")).toBeVisible();
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("until back in the barn")).toBeVisible();
  // Stamina 100 × Light 0.6.
  await expect.poll(() => headerCredits(page)).toBe(before - 60);
});
