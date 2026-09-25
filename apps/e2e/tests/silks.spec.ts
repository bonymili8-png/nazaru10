import { expect, newOwner, test } from "./fixtures.js";

test("an owner restyles free silks; locked patterns need gems", async ({ page }) => {
  await newOwner(page);
  await page.goto("/profile/");
  await page.getByRole("link", { name: "Racing silks" }).click();
  await expect(page.getByRole("heading", { name: "Racing silks" })).toBeVisible();

  // No gems yet: unlocking is refused with a clear message.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("radio", { name: /Star/ }).click();
  await expect(page.getByText(/Not enough GEMS/i)).toBeVisible();

  await page
    .getByRole("radiogroup", { name: "primary colour" })
    .getByRole("radio", { name: "Royal" })
    .click();
  await page.getByRole("button", { name: "Save silks" }).click();
  await expect(page.getByText(/Silks saved/)).toBeVisible();
  await page.screenshot({ path: "/tmp/claude-0/shots/silks.png", fullPage: true });
  await page.reload();
  await expect(
    page.getByRole("radiogroup", { name: "primary colour" }).getByRole("radio", { name: "Royal" }),
  ).toHaveAttribute("aria-checked", "true");
});
