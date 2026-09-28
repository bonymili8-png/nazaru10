import { expect, newOwner, test } from "./fixtures.js";

test("an owner goes back to where they were", async ({ page }) => {
  await newOwner(page);
  const back = page.getByRole("button", { name: "Back", exact: true });

  // Sections of the bottom menu have no back button.
  await page.getByRole("link", { name: "Horses" }).click();
  await expect(page.getByText(/boxes used/)).toBeVisible();
  await expect(back).toHaveCount(0);

  // Horses → a horse → Back returns to the list.
  await page.locator("a[href^='/horse/?id=']").first().click();
  await expect(page.getByRole("tab", { name: "overview" })).toBeVisible();
  const horseUrl = page.url();
  await back.click();
  await expect(page).toHaveURL(/\/horses\/$/);
  await expect(page.getByText(/boxes used/)).toBeVisible();

  // Across sections: Races → a race → Back to the race card.
  await page.getByRole("link", { name: "Races" }).click();
  await page.locator("a[href^='/race/?id=']").first().click();
  await expect(page).toHaveURL(/\/race\/\?id=/);
  await back.click();
  await expect(page).toHaveURL(/\/races\/$/);

  // Opened directly (deep link or reload): Back goes up to the section, never out of the game.
  await page.goto(horseUrl);
  await expect(page.getByRole("tab", { name: "overview" })).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/horses\/$/);
});

test("Telegram's own Back button mirrors the in-app one", async ({ page }) => {
  await newOwner(page);
  // Stand-in for the Telegram client: records the BackButton state and its click handler.
  await page.evaluate(() => {
    const w = window as unknown as { Telegram: unknown; __back: { visible: boolean; cb: (() => void) | null } };
    w.__back = { visible: false, cb: null };
    w.Telegram = {
      WebApp: {
        initData: "mock",
        initDataUnsafe: {},
        BackButton: {
          show: () => (w.__back.visible = true),
          hide: () => (w.__back.visible = false),
          onClick: (cb: () => void) => (w.__back.cb = cb),
          offClick: () => (w.__back.cb = null),
        },
      },
    };
  });
  const state = () =>
    page.evaluate(() => (window as unknown as { __back: { visible: boolean } }).__back.visible);

  await page.getByRole("link", { name: "Horses" }).click();
  await expect(page.getByText(/boxes used/)).toBeVisible();
  expect(await state()).toBe(false);
  await page.locator("a[href^='/horse/?id=']").first().click();
  await expect(page.getByRole("tab", { name: "overview" })).toBeVisible();
  await expect.poll(state).toBe(true);

  // Pressing it in Telegram's header goes back like the in-app button.
  await page.evaluate(() => (window as unknown as { __back: { cb: () => void } }).__back.cb());
  await expect(page).toHaveURL(/\/horses\/$/);
  await expect.poll(state).toBe(false);
});
