import { expect, newOwner, openFirstHorse, test } from "./fixtures.js";

test("an owner dresses a horse in a saddle cloth", async ({ page }) => {
  await newOwner(page);
  await openFirstHorse(page);
  await expect(page.getByRole("heading", { name: "Saddle cloth" })).toBeVisible();

  // Paid patterns need gems (a new owner has none).
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("radiogroup", { name: "Cloth pattern" })
    .getByRole("radio", { name: /Stripe/ })
    .click();
  await expect(page.getByText(/Not enough gems/i)).toBeVisible();

  await page
    .getByRole("radiogroup", { name: "Cloth colour" })
    .getByRole("radio", { name: "Scarlet" })
    .click();
  await page.getByRole("radiogroup", { name: "Trim colour" }).getByRole("radio", { name: "Gold" }).click();
  await page.getByRole("button", { name: "Save cloth" }).click();
  await expect(page.getByText("Saddle cloth saved")).toBeVisible();
  await page.getByRole("heading", { name: "Saddle cloth" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/claude-0/shots/cloth.png" });

  await page.reload();
  await expect(
    page.getByRole("radiogroup", { name: "Cloth colour" }).getByRole("radio", { name: "Scarlet" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Save cloth" })).toBeDisabled();
  await page.getByRole("link", { name: "Horses" }).click();
  await page.screenshot({ path: "/tmp/claude-0/shots/cloth-card.png" });
});
