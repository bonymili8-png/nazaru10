import { expect, newOwner, test } from "./fixtures.js";

test("a seller sees how to feature a listing; featuring needs gems", async ({ page }) => {
  await newOwner(page);
  await page.goto("/horses/");
  await page.locator("a[href^='/horse/?id=']").first().click();
  await page.getByRole("radio", { name: "Fixed price" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "List on the market" }).click();
  await page.getByRole("link", { name: "View listing" }).click();

  await expect(page.getByText(/shown first to every buyer/)).toBeVisible();
  // A new owner has no gems: the purchase is refused with a clear message.
  await page.getByRole("button", { name: /Feature for 30 gems/ }).click();
  await expect(page.getByText("Not enough gems.")).toBeVisible();
});
