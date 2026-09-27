import { expect, newOwner, test } from "./fixtures.js";

test("an owner restyles free silks; locked patterns need gems", async ({ page }) => {
  await newOwner(page);
  await page.goto("/profile/");
  await page.getByRole("link", { name: "Racing silks" }).click();
  await expect(page.getByRole("heading", { name: "Racing silks" })).toBeVisible();

  // No gems yet: unlocking is refused with a clear message.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("radio", { name: /Star/ }).click();
  await expect(page.getByText(/Not enough gems/i)).toBeVisible();

  // Colour palettes stay folded until asked for, and fold again after a pick.
  await expect(page.getByRole("radiogroup", { name: "Body colour" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Body colour:/ }).click();
  await page.getByRole("radiogroup", { name: "Body colour" }).getByRole("radio", { name: "Royal" }).click();
  await expect(page.getByRole("radiogroup", { name: "Body colour" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save silks" }).click();
  await expect(page.getByText(/Silks saved/)).toBeVisible();
  await page.screenshot({ path: "/tmp/claude-0/shots/silks.png", fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Body colour: Royal" })).toBeVisible();
});
