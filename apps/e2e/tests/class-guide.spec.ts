import { expect, newOwner, test } from "./fixtures.js";

test("an owner sees which race classes a horse can enter and why", async ({ page }) => {
  await newOwner(page);

  // A new horse: race rating 1000, no wins → maiden races and Class 5.
  await page.goto("/horses/");
  await page.locator("a[href^='/horse/?id=']").first().click();
  await expect(page.getByText("Ability", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Race rating", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Can race in")).toBeVisible();
  // Owners can share their horse (the link also credits them as the inviter).
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect(page.getByText("Maiden", { exact: true }).first()).toBeVisible();

  // The races page explains every class's race-rating band, with no overlaps.
  await page.goto("/races/");
  await page.getByText("How ratings and classes work").click();
  const guide = page.locator("details").filter({ hasText: "How ratings and classes work" });
  for (const band of ["up to 1099", "1100–1199", "1200–1299", "1300–1399", "1400 and above"])
    await expect(guide.getByText(band)).toBeVisible();
});
