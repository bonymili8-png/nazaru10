import { expect, newOwner, openFirstHorse, openSection, test } from "./fixtures.js";

test("an owner follows another owner's horse and sees it under Following", async ({ page, browser }) => {
  await newOwner(page);
  await openFirstHorse(page);
  const horseUrl = page.url();
  const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  // No follow button on your own horse.
  await expect(page.getByRole("button", { name: "Follow" })).toHaveCount(0);

  const fan = await browser.newPage();
  await newOwner(fan);
  await fan.goto("/horses/");
  await expect(fan.getByText(/Follow horses from their page/)).toBeVisible();
  await fan.goto(horseUrl);
  await fan.getByRole("button", { name: "Follow" }).click();
  await expect(fan.getByText(`Following ${name}`)).toBeVisible();
  await expect(fan.getByRole("button", { name: "Unfollow" })).toHaveAttribute("aria-pressed", "true");

  await fan.goto("/horses/");
  await openSection(fan, "Following");
  await expect(fan.getByText(name)).toBeVisible();
  await expect(fan.getByText("No race entered")).toBeVisible();
  await fan.close();
});
