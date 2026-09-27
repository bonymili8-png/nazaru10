import { expect, newOwner, test } from "./fixtures.js";

test("the Owners' Circle is offered with its perks; member colours stay locked", async ({ page }) => {
  await newOwner(page);
  await page.getByRole("link", { name: "Market" }).click();
  await page.getByRole("tab", { name: "Gems" }).click();
  await expect(page.getByText("Owners' Circle", { exact: true })).toBeVisible();
  await expect(page.getByText("300 gems every month")).toBeVisible();
  await expect(page.getByText("Free race report for every race your horses run")).toBeVisible();
  await expect(page.getByText("No race advantages — cosmetics and convenience only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Subscribe · 150 ⭐ / month" })).toBeVisible();
  await page.screenshot({ path: "/tmp/claude-0/shots/membership.png", fullPage: true });

  // Outside Telegram purchases are refused politely.
  await page.getByRole("button", { name: "Subscribe · 150 ⭐ / month" }).click();
  await expect(page.getByText("Purchases are available inside Telegram")).toBeVisible();

  await page.goto("/silks/");
  await page.getByRole("button", { name: /^Body colour:/ }).click();
  const platinum = page
    .getByRole("radiogroup", { name: "Body colour" })
    .getByRole("radio", { name: "Platinum · Owners' Circle colour" });
  await expect(platinum).toBeDisabled();
});
