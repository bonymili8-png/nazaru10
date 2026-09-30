import { expect, headerCredits, newOwner, plantYardEvent, test } from "./fixtures.js";

test("an owner decides what to do about trouble in the yard", async ({ page }) => {
  const devId = await newOwner(page);
  await plantYardEvent(devId, "OFF_FEED");
  await plantYardEvent(devId, "CAST_IN_BOX");
  await page.reload();

  // Both events wait on the home screen as a choice, with no advice attached.
  await expect(page.getByRole("heading", { name: "In the yard" })).toBeVisible();
  await expect(page.getByText("Off its feed")).toBeVisible();
  await expect(page.getByText("Cast in the box")).toBeVisible();

  // Calling the vet costs the call-out.
  const before = await headerCredits(page);
  await page.getByRole("button", { name: "Call the vet · 120 cr" }).click();
  await expect(page.getByText(/−120 cr$/)).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before - 120);
  await expect(page.getByText("Off its feed")).toHaveCount(0);

  // Leaving it to your own people costs nothing; the horses page shows how it went.
  await page.getByRole("button", { name: "Get it up yourselves" }).click();
  await expect(page.getByText(/trust|health/).first()).toBeVisible();
  await page.getByRole("link", { name: "Horses" }).click();
  await expect(page.getByRole("heading", { name: "In the yard" })).toBeVisible();
  await expect(page.getByText(/: cast in the box$/)).toBeVisible();
  await expect(page.getByText(/: off its feed$/)).toBeVisible();
});
