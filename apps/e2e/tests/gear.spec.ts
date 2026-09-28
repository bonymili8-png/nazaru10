import { expect, headerCredits, newOwner, test } from "./fixtures.js";

test("an owner buys blinkers and races with them", async ({ page }) => {
  await newOwner(page);
  await page.goto("/horses/");
  const before = await headerCredits(page);
  // The gear shop is folded until opened.
  const row = page.getByRole("listitem").filter({ hasText: "Blinkers" });
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /In the tack room: 0 of 5/ }).click();
  page.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: /Buy · 1,200 cr/ }).click();
  await expect(page.getByText("Blinkers added to the tack room")).toBeVisible();
  await expect(row.getByText("40 races left")).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before - 1200);

  await page.goto("/races/");
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "Maiden", exact: true }).click();
    await expect(page.locator("a[href^='/race/?id=']").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await page.locator("a[href^='/race/?id=']").first().click();

  const gear = page.getByRole("radiogroup", { name: "Race-day gear" });
  await expect(gear.getByRole("radio", { name: /None/ })).toHaveAttribute("aria-checked", "true");
  await gear.getByRole("radio", { name: /Blinkers/ }).click();
  await expect(gear.getByText("+10 Focus · −3 Agility")).toBeVisible();
  await page.getByRole("button", { name: /^Enter · / }).click();
  await expect(page.getByText("Entered! Good luck.")).toBeVisible();
});
