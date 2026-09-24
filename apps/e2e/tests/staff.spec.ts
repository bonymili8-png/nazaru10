import { expect, headerCredits, newOwner, openFirstHorse, test } from "./fixtures.js";

test("an owner hires a trainer who then supervises training", async ({ page }) => {
  await newOwner(page);
  const before = await headerCredits(page);
  await page.getByRole("link", { name: "Horses" }).click();
  await page.getByRole("link", { name: "Staff" }).click();
  await expect(page.getByRole("heading", { name: "Available trainers" })).toBeVisible();

  // Trainers are exclusive and tests run in parallel: hire whichever is still free.
  await expect(async () => {
    await page.reload();
    const hire = page.getByRole("button", { name: /^Hire · / }).last();
    await hire.click({ timeout: 2000 });
    await expect(page.getByText(/joined your stable/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });

  await expect(page.getByRole("heading", { name: /Your team \(1\/1\)/ })).toBeVisible();
  const cost = before - (await headerCredits(page));
  expect(cost).toBeGreaterThan(0);

  await openFirstHorse(page);
  await page.getByRole("tab", { name: "train" }).click();
  await expect(page.getByText(/% gains/)).toBeVisible();
});

test("an owner retains a jockey", async ({ page }) => {
  await newOwner(page);
  const before = await headerCredits(page);
  await page.getByRole("link", { name: "Horses" }).click();
  await page.getByRole("link", { name: "Staff" }).click();
  await page.getByRole("tab", { name: "jockeys" }).click();
  await expect(page.getByRole("heading", { name: "Available jockeys" })).toBeVisible();
  await expect(async () => {
    const retain = page.getByRole("button", { name: /^Retain · / }).last();
    await retain.click({ timeout: 2000 });
    await expect(page.getByText(/will ride for your stable/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: /Your jockeys \(1\/1\)/ })).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBeLessThan(before);
});
