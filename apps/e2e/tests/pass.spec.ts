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
  // Every tier carries a reward now (small gem rewards fill the former gaps).
  await expect(page.getByText("No reward on this tier — keep going")).toHaveCount(0);
  // Free-track tiers pay credits on top of gems.
  await expect(page.getByText("+ 50 cr")).toBeVisible();
  await page.getByText("+ 50 cr").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/claude-0/shots/pass.png" });
});
