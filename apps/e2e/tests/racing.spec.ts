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

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Withdrawn — fee refunded")).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before);
});
