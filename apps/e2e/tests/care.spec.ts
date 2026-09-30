import { expect, newOwner, openFirstHorse, openSection, test } from "./fixtures.js";

test("an owner does the yard round and cares for a horse between starts", async ({ page }) => {
  await newOwner(page);
  await page.getByRole("link", { name: "Horses" }).click();

  // The yard round is folded until asked for; it offers lads for gems and grooming for every horse.
  await expect(page.getByRole("heading", { name: "Yard round" }).getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await openSection(page, "Yard round");
  await expect(page.getByText("Stable lads")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /^Hire 1 lad \(up to 5 horses\) · 50 \/ week/ }).click();
  await expect(page.getByText(/Not enough gems/i)).toBeVisible();
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
