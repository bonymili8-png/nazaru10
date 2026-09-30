import { expect, newOwner, test } from "./fixtures.js";

test("stable lads can be hired from the staff page", async ({ page }) => {
  await newOwner(page);
  await page.getByRole("link", { name: "Horses" }).click();
  await page.getByRole("link", { name: "Staff" }).click();
  await page.getByRole("tab", { name: "Stable lads" }).click();
  await expect(page.getByText(/Hire lads to do this round for you/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Hire 1 lad \(up to 5 horses\) · 50 \/ week/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Hire 2 lads \(the whole yard\) · 100 \/ week/ }),
  ).toBeVisible();
});
