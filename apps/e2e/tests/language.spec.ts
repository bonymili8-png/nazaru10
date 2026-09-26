import { expect, newOwner, test } from "./fixtures.js";

test("an owner switches the game to Ukrainian and it sticks", async ({ page }) => {
  await newOwner(page);
  await page.goto("/profile/");
  await page.getByRole("radio", { name: "Українська" }).click();

  // The whole shell re-renders in Ukrainian, numbers included.
  const nav = page.getByRole("navigation", { name: "Головне меню" });
  await expect(nav.getByRole("link", { name: "Головна" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Мова" })).toBeVisible();

  await nav.getByRole("link", { name: "Коні" }).click();
  await expect(page.getByRole("heading", { name: "Ваші коні" })).toBeVisible();
  await page.locator("a[href^='/horse/?id=']").first().click();
  await page.getByRole("tab", { name: "Тренування" }).click();
  await expect(page.getByRole("button", { name: "Почати тренування" })).toBeVisible();

  await page.goto("/races/");
  await expect(page.getByRole("heading", { name: "Програма забігів" })).toBeVisible();

  // Survives a reload and can be switched back.
  await page.goto("/profile/");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Мова" })).toBeVisible();
  await page.screenshot({ path: "/tmp/claude-0/shots/profile-uk.png", fullPage: true });
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Language" })).toBeVisible();
});
