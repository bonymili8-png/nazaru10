import { expect, headerCredits, newOwner, test } from "./fixtures.js";

test("an owner registers for the Local Cup and withdraws before the draw", async ({ page }) => {
  await newOwner(page);
  const before = await headerCredits(page);
  await page.getByRole("link", { name: "Races" }).click();
  await page.getByRole("link", { name: "Tournaments" }).click();
  const local = page.locator("a[href^='/tournament/?id=']", { hasText: "Local Cup" }).first();
  await expect(async () => {
    await page.reload();
    await expect(local).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await local.click();

  const register = page.getByRole("button", { name: /^Register · / });
  const fee = Number((await register.innerText()).replace(/[^\d]/g, ""));
  await register.click();
  await expect(page.getByText(/Registered! The draw/)).toBeVisible();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before - fee);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Withdrawn — fee refunded")).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before);
});
