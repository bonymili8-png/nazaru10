import { expect, newOwner, test } from "./fixtures.js";

test("an owner signs a weekly sponsor contract", async ({ page }) => {
  await newOwner(page);
  await page.getByRole("link", { name: /Sign a sponsor this week/ }).click();
  await expect(page.getByRole("heading", { name: "Sponsors" })).toBeVisible();
  const sign = page.getByRole("button", { name: /^Sign with / });
  await expect(sign).toHaveCount(3);
  await sign.first().click();
  await expect(page.getByText("Contract signed — good luck!")).toBeVisible();
  await expect(page.getByText("Active contract")).toBeVisible();
  await expect(page.getByText("0 of")).toBeVisible();
  // One contract a week: the other offers are now closed.
  await expect(sign.first()).toBeDisabled();
  await page.screenshot({ path: "/tmp/claude-0/shots/sponsors.png", fullPage: true });
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText(/^Sponsor: /)).toBeVisible();
});
