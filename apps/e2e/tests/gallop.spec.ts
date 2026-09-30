import { expect, newOwner, openFirstHorse, openSection, test } from "./fixtures.js";

test("an owner clocks a horse against a lead horse and reads the work", async ({ page }) => {
  await newOwner(page);
  await openFirstHorse(page);
  await openSection(page, "Morning work");

  await page.getByRole("radiogroup", { name: "Distance" }).getByRole("radio", { name: "800m" }).click();
  await page.getByRole("radiogroup", { name: "Surface" }).getByRole("radio", { name: "Dirt" }).click();
  await page
    .getByRole("radiogroup", { name: "Lead horse of" })
    .getByRole("radio", { name: "Class 5" })
    .click();
  await page.getByRole("button", { name: /^Send out/ }).click();

  // The work is on the clock, compared with the lead horse; no verdict is drawn for the owner.
  const work = page.getByRole("list", { name: "Last pieces of work" }).getByRole("listitem");
  await expect(work).toHaveCount(1);
  await expect(work.first()).toContainText(/800m Dirt/);
  await expect(work.first()).toContainText(/Class 5 lead \d:\d\d\.\d/);
  await expect(work.first()).toContainText(/beat it by|behind|level/);
  await expect(page.getByRole("button", { name: /^Send out/ })).toBeDisabled();
  await expect(page.getByText(/^Can work again in/).first()).toBeVisible();
});
