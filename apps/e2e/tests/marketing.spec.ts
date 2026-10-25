import { expect, newOwner, sql, test } from "./fixtures.js";

test("the content team controls the game's own channel from the console", async ({ page }) => {
  const devId = await newOwner(page);
  await sql("UPDATE users SET role = 'CONTENT_ADMIN' WHERE telegram_id = $1", [devId]);
  await page.goto("/admin/");
  await page.getByRole("tab", { name: "marketing" }).click();
  await expect(page.getByRole("heading", { name: "Telegram channel" })).toBeVisible();
  // No bot token in this environment: the console says why it cannot post.
  await expect(page.getByText("cannot post")).toBeVisible();
  await expect(page.getByText(/bot token is not configured/)).toBeVisible();

  const all = page.getByRole("switch", { name: "Automatic posting" });
  // The e2e database persists: start from ON.
  if ((await all.getAttribute("aria-checked")) === "false") {
    page.once("dialog", (d) => void d.accept());
    await all.click();
  }
  await expect(all).toHaveAttribute("aria-checked", "true");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("switch", { name: "Race of the day" }).click();
  await expect(page.getByRole("switch", { name: "Race of the day" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("switch", { name: "Race of the day" }).click();
  await expect(page.getByRole("switch", { name: "Race of the day" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("TGCHDAY")).toBeVisible();

  // A channel the bot cannot post to is refused, and the current one stays.
  await page.getByLabel("Channel handle").fill("@another_channel");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/bot token is not configured/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Telegram channel" })).toBeVisible();
});
