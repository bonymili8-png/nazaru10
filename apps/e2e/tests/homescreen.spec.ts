import { expect, newOwner, test } from "./fixtures.js";

/** Stand-in for a Telegram client that supports home-screen shortcuts (Bot API 8.0+). */
async function mockTelegram(page: import("@playwright/test").Page, status: string) {
  await page.evaluate((initial) => {
    const handlers: Record<string, (() => void)[]> = {};
    const w = window as unknown as { Telegram: unknown; __hsStatus: string };
    w.__hsStatus = initial;
    w.Telegram = {
      WebApp: {
        initData: "mock",
        initDataUnsafe: {},
        isVersionAtLeast: () => true,
        checkHomeScreenStatus: (cb: (s: string) => void) => cb(w.__hsStatus),
        addToHomeScreen: () => {
          w.__hsStatus = "added";
          (handlers.homeScreenAdded ?? []).slice().forEach((h) => h());
        },
        onEvent: (e: string, h: () => void) => (handlers[e] ??= []).push(h),
        offEvent: (e: string, h: () => void) => {
          handlers[e] = (handlers[e] ?? []).filter((x) => x !== h);
        },
      },
    };
  }, status);
}

test("an owner pins the game to the phone's home screen", async ({ page }) => {
  await newOwner(page);
  const nav = page.getByRole("navigation", { name: "Main" });

  // Outside Telegram (a plain browser) there is nothing to offer.
  await page.goto("/profile/");
  await expect(page.getByRole("heading", { name: "Language" })).toBeVisible();
  await expect(page.getByText("Home screen shortcut")).toHaveCount(0);

  // In a supporting Telegram client the home page nudges once, and can be hidden.
  await mockTelegram(page, "missed");
  await nav.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText("Keep Thoroughline one tap away")).toBeVisible();
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByText("Keep Thoroughline one tap away")).toHaveCount(0);

  // The profile keeps the option, and confirms once the shortcut exists.
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByText("Home screen shortcut")).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added to your home screen")).toBeVisible();
  await expect(page.getByText("The game is already on your home screen.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
});
