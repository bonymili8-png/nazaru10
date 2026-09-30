import { expect, newOwner, openFirstHorse, openSection, test } from "./fixtures.js";

test("an owner does the yard round and cares for a horse between starts", async ({ page }) => {
  await newOwner(page);
  await page.getByRole("link", { name: "Horses" }).click();

  // The yard round offers grooming for every horse; one tap does the job.
  await openSection(page, "Yard round");
  await page.getByRole("button", { name: "Groom" }).first().click();
  await expect(page.getByText(/groomed$/)).toBeVisible();

  // On the horse page, grooming now waits for its cooldown; a walk is still on offer.
  await openFirstHorse(page);
  await openSection(page, "Daily care");
  await expect(page.getByRole("button", { name: /^Groom/ })).toBeDisabled();
  await expect(page.getByText(/^Again in/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cold-hose the legs/ })).toBeDisabled();
  await expect(page.getByText("Only in the hours after a race")).toBeVisible();
  await page.getByRole("button", { name: /^Walk in hand/ }).click();
  await expect(page.getByText(/walked$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Walk in hand/ })).toBeDisabled();
  await expect(page.getByText(/Shoes: 0 of 6 starts/)).toBeVisible();
});
