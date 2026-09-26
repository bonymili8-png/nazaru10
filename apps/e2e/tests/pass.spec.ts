import { expect, newOwner, test } from "./fixtures.js";

test("the Racing Pass shows progress, tracks and locked premium rewards", async ({ page }) => {
  await newOwner(page);
  await expect(page.getByText(/Racing Pass · tier 0\/20/)).toBeVisible();
  await page.getByText(/Racing Pass · tier/).click();
  await expect(page.getByRole("heading", { name: "Racing Pass" })).toBeVisible();
  await expect(page.getByText(/Earn XP by playing/)).toBeVisible();
  // A new owner cannot afford premium and has nothing to claim yet.
  await expect(page.getByRole("button", { name: /Unlock premium/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Claim tier/ })).toHaveCount(0);
  await expect(page.getByText("Chevron silks")).toBeVisible();
});
