import { expect, headerCredits, newOwner, test } from "./fixtures.js";

test("an owner enters a maiden race and withdraws for a full refund", async ({ page }) => {
  await newOwner(page);
  const before = await headerCredits(page);
  await page.getByRole("link", { name: "Races" }).click();
  await page.getByRole("button", { name: "Maiden", exact: true }).click();
  // The job runner schedules the card shortly after the API starts.
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "Maiden", exact: true }).click();
    await expect(page.locator("a[href^='/race/?id=']").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await page.locator("a[href^='/race/?id=']").first().click();

  const enter = page.getByRole("button", { name: /^Enter · / });
  const fee = Number((await enter.innerText()).replace(/[^\d]/g, ""));
  await page.getByRole("radio", { name: /Closer/ }).click();
  await enter.click();
  await expect(page.getByText("Entered! Good luck.")).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before - fee);

  // The owner's only horse is now listed with the reason it can't be entered again.
  await expect(page.getByText("None of your horses can run in this race:")).toBeVisible();
  await expect(page.getByText(/busy — Entered/)).toBeVisible();

  // "My races" shows only races this owner has a horse in.
  const raceUrl = page.url();
  await page.getByRole("link", { name: "Races" }).click();
  await page.getByRole("radio", { name: "My races" }).click();
  const cards = page.locator("a[href^='/race/?id=']");
  await expect(cards).toHaveCount(1);
  await cards.first().click();
  await expect(page).toHaveURL(raceUrl);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Withdrawn — fee refunded")).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before);
});
