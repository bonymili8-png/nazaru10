import { expect, newOwner, sql, test } from "./fixtures.js";

test("an admin creates a campaign link for a partner and sees its visits", async ({ page, browser }) => {
  const devId = await newOwner(page);
  await sql("UPDATE users SET role = 'SUPER_ADMIN' WHERE telegram_id = $1", [devId]);
  await page.goto("/admin/");
  await page.getByRole("tab", { name: "campaigns" }).click();

  const code = `E${Date.now().toString(36).toUpperCase().slice(-6)}`;
  await page.getByLabel("Name (where it will be posted)").fill("UK Racing Fans · Facebook");
  await page.getByLabel("Partner (group admin or author)").fill("John Smith");
  await page.getByRole("radio", { name: "Facebook" }).click();
  await page.getByLabel(/^Code/).fill(code);
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText(`Link ${code} created`)).toBeVisible();
  const card = page.locator("div", { hasText: code }).filter({ hasText: "John Smith" }).last();
  await expect(card.getByText(`/go/?c=${code}`)).toBeVisible();

  // Someone follows the link from a group post (no sign-in): the visit is counted.
  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await visitor.goto(`/go/?c=${code}`);
  await expect(visitor.getByRole("heading", { name: "Opening the game in Telegram…" })).toBeVisible();
  await expect
    .poll(async () => {
      await page.reload();
      await page.getByRole("tab", { name: "campaigns" }).click();
      const row = page.locator("div", { hasText: code }).filter({ hasText: "Link visits" }).last();
      return (await row.innerText()).match(/Link visits\s*(\d+)/)?.[1];
    })
    .toBe("1");
  await ctx.close();
});
