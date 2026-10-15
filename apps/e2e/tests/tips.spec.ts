import { expect, newOwner, test } from "./fixtures.js";

test("a player tips a race with another owner's horse in the tipster league", async ({ page, browser }) => {
  // An owner enters a maiden race, which opens it for tips.
  await newOwner(page);
  await page.getByRole("link", { name: "Races" }).click();
  await page.getByRole("button", { name: "Maiden", exact: true }).click();
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "Maiden", exact: true }).click();
    await expect(page.locator("a[href^='/race/?id=']").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await page.locator("a[href^='/race/?id=']").first().click();
  await page.getByRole("radio", { name: /Closer/ }).click();
  await page.getByRole("button", { name: /^Enter · / }).click();
  await expect(page.getByText("Entered! Good luck.")).toBeVisible();
  const raceId = new URL(page.url()).searchParams.get("id")!;

  // Another player finds it in the league and tips it.
  const ctx = await browser.newContext();
  const tipster = await ctx.newPage();
  await newOwner(tipster);
  await tipster.getByRole("link", { name: "Races" }).click();
  await tipster.getByRole("link", { name: "Tips" }).click();
  await expect(tipster.getByRole("heading", { name: "Tipster league" })).toBeVisible();
  await expect(tipster.getByText("Points only — no stakes, no betting.")).toBeVisible();
  await tipster.locator(`a[href='/race/?id=${raceId}']`).click();

  await expect(tipster.getByRole("heading", { name: "Your tip" })).toBeVisible();
  const runner = tipster.getByRole("list", { name: "Runners" }).getByRole("button").first();
  await expect(runner).toContainText("if wins");
  await runner.click();
  await expect(runner).toHaveAttribute("aria-pressed", "true");
  await tipster.getByRole("button", { name: "Place tip" }).click();
  await expect(tipster.getByText("Tip saved")).toBeVisible();
  await expect(tipster.getByRole("button", { name: "Update tip" })).toBeDisabled();

  // The tip is listed in the league, waiting for the result.
  await tipster.getByRole("link", { name: "Tipster league" }).click();
  await expect(
    tipster.locator(`a[href='/race/?id=${raceId}']`).filter({ hasText: /:/ }).last(),
  ).toBeVisible();
  await expect(tipster.getByText("Tipped")).toBeVisible();
  await ctx.close();
});
