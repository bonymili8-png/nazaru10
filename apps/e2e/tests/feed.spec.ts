import { expect, headerCredits, newOwner, test } from "./fixtures.js";

test("an owner puts a horse on premium feed and stops the renewal", async ({ page }) => {
  await newOwner(page);
  await page.goto("/horses/");
  await page.locator("a[href^='/horse/?id=']").first().click();

  const feed = page.getByRole("radiogroup", { name: "Feed" });
  await expect(feed.getByRole("radio", { name: /Standard/ })).toHaveAttribute("aria-checked", "true");
  const before = await headerCredits(page);
  page.once("dialog", (d) => void d.accept());
  await feed.getByRole("radio", { name: /Premium/ }).click();
  await expect(page.getByText("Premium feed started")).toBeVisible();
  await expect(feed.getByRole("radio", { name: /Premium/ })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => headerCredits(page)).toBe(before - 200);
  await expect(page.getByText(/renews automatically/)).toBeVisible();

  await page.getByRole("button", { name: "Stop renewal" }).click();
  await expect(page.getByText(/then back to standard/)).toBeVisible();
  await page.getByRole("button", { name: "Resume renewal" }).click();
  await expect(page.getByText(/renews automatically/)).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before - 200);
});
