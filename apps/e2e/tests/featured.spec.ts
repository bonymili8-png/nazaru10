import { expect, giveSpareHorse, newOwner, openSection, test } from "./fixtures.js";

test("a seller sees how to feature a listing; featuring needs gems", async ({ page }) => {
  const devId = await newOwner(page);
  await page.goto("/horses/");
  await page.locator("a[href^='/horse/?id=']").first().click();
  await openSection(page, "Sell");
  await page.getByRole("radio", { name: "Fixed price" }).click();
  // The starter horse is the only one: it can't be sold until the stable has another.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "List on the market" }).click();
  await expect(page.getByText(/Keep at least one horse in your stable/)).toBeVisible();
  const horseUrl = page.url();
  await giveSpareHorse(devId);

  await page.goto(horseUrl);
  await openSection(page, "Sell");
  await page.getByRole("radio", { name: "Fixed price" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "List on the market" }).click();
  await page.getByRole("link", { name: "View listing" }).click();

  await expect(page.getByText(/shown first to every buyer/)).toBeVisible();
  // A new owner has no gems: the purchase is refused with a clear message.
  await page.getByRole("button", { name: /Feature for 30 gems/ }).click();
  await expect(page.getByText("Not enough gems.")).toBeVisible();
});
