import { expect, headerCredits, newOwner, test } from "./fixtures.js";

test("an owner founds a club, sees it ranked and leaves it", async ({ page }) => {
  const id = await newOwner(page);
  const before = await headerCredits(page);
  await page.getByRole("link", { name: "Rankings" }).click();
  await page.getByRole("tab", { name: "Clubs" }).click();
  await page.getByRole("button", { name: "Found a club" }).click();
  const tag = `T${id % 1000}`.slice(0, 4);
  await page.getByLabel("Club name").fill(`E2E Club ${id}`);
  await page.getByLabel("Tag (2–4 letters)").fill(tag);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /Found a club · / }).click();

  await expect(page.getByRole("heading", { name: `E2E Club ${id}` })).toBeVisible();
  await expect(page.getByText("Owner", { exact: true })).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before - 5000);
  await page.screenshot({ path: "/tmp/claude-0/shots/club.png" });

  // Founding a club makes the racing news (the job runner ingests events every few seconds).
  await page.goto("/feed/");
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(`founded the club E2E Club ${id}`)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.screenshot({ path: "/tmp/claude-0/shots/feed.png" });
  await page.goto("/rankings/?tab=clubs");
  await page.getByRole("link", { name: /Your club/ }).click();
  await page.getByRole("link", { name: "Back" }).click();
  await page.getByRole("tab", { name: "Clubs" }).click();
  await expect(page.getByRole("link", { name: /Your club/ })).toBeVisible();
  await page.getByLabel("Search clubs").fill(`E2E Club ${id}`);
  await expect(page.locator("a[href^='/club/?id=']").filter({ hasText: tag })).toHaveCount(1);
  await page.screenshot({ path: "/tmp/claude-0/shots/clubs.png" });

  await page.getByRole("link", { name: /Your club/ }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Leave club" }).click();
  // Back on the Clubs tab (the club closed with its last member), with the rejoin cooldown shown.
  await expect(page).toHaveURL(/\/rankings\/\?tab=clubs/);
  await expect(page.getByText(/You can join or found a club again in/)).toBeVisible();
});
