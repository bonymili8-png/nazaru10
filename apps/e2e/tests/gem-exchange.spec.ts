import { expect, headerCredits, newOwner, sql, test } from "./fixtures.js";

test("an owner buys credits with gems; the admin switches the exchange off and on", async ({ page }) => {
  const devId = await newOwner(page);
  await sql("UPDATE users SET role = 'SUPER_ADMIN' WHERE telegram_id = $1", [devId]);

  // Admin: give this owner gems, and make sure the exchange is on (the e2e database persists).
  await page.goto("/admin/");
  await page.getByRole("tab", { name: "users" }).click();
  await page.getByLabel("Search users").fill(String(devId));
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(`tg ${devId}`) }).click();
  await page.getByLabel("Currency").selectOption("GEMS");
  await page.getByLabel("Amount (negative to remove)").fill("200");
  await page.getByLabel("Reason (required, audited)").first().fill("E2E gems for the exchange");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Apply adjustment" }).click();
  await expect(page.getByText("Balance adjusted")).toBeVisible();

  await page.getByRole("tab", { name: "economy" }).click();
  await expect(page.getByRole("heading", { name: "Gems → credits exchange" })).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Gems to credits exchange" });
  if ((await toggle.getAttribute("aria-checked")) === "false") {
    page.once("dialog", (d) => void d.accept());
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("100 gems → 1,100 cr (+10%)")).toBeVisible();

  // Owner: the shop's gems tab sells credits by the bundle.
  await page.goto("/shop/?tab=gems");
  await expect(page.getByRole("heading", { name: "Credits for gems" })).toBeVisible();
  await expect(page.getByText("1 gem = 10 cr — bigger bundles add a bonus.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy 7,000 credits for 550 gems" })).toBeDisabled();
  const before = await headerCredits(page);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Buy 1,100 credits for 100 gems" }).click();
  await expect(page.getByText("+1,100 credits added to your wallet")).toBeVisible();
  await expect.poll(() => headerCredits(page)).toBe(before + 1_100);
  await expect(page.getByText("Today: 1,100 of 10,000 cr")).toBeVisible();

  // Admin: switched off, the shop hides it; on again, it is back.
  await page.goto("/admin/");
  await page.getByRole("tab", { name: "economy" }).click();
  await page.getByLabel("Reason for the change (optional, kept in the audit log)").fill("E2E pause");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("switch", { name: "Gems to credits exchange" }).click();
  await expect(page.getByRole("switch", { name: "Gems to credits exchange" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.getByText("E2E pause").first()).toBeVisible();
  await page.goto("/shop/?tab=gems");
  await expect(page.getByText(/Gems buy diagnostics, cosmetics and credits/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Credits for gems" })).toHaveCount(0);

  await page.goto("/admin/");
  await page.getByRole("tab", { name: "economy" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("switch", { name: "Gems to credits exchange" }).click();
  await expect(page.getByRole("switch", { name: "Gems to credits exchange" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.goto("/shop/?tab=gems");
  await expect(page.getByRole("heading", { name: "Credits for gems" })).toBeVisible();
});

test("tapping a balance in the header or on the profile opens the market's gems tab", async ({ page }) => {
  await newOwner(page);
  const gemsTab = page.getByRole("tab", { name: "Gems" });
  // Header gems → market, gems tab.
  await page.getByRole("link", { name: "Top up gems" }).click();
  await expect(page.getByRole("heading", { name: "Market" })).toBeVisible();
  await expect(gemsTab).toHaveAttribute("aria-selected", "true");
  // Already in the market on another tab: the header credits still switch to gems.
  await page.getByRole("tab", { name: "Players" }).click();
  await expect(gemsTab).toHaveAttribute("aria-selected", "false");
  await page.getByRole("link", { name: "Top up credits" }).click();
  await expect(gemsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Gems buy diagnostics, cosmetics and credits/)).toBeVisible();
  // Profile cards: credits and gems open the same place; reputation is not a link.
  await page.goto("/profile/");
  await expect(page.getByRole("link", { name: /^Reputation/ })).toHaveCount(0);
  await page.getByRole("link", { name: /^Gems\s*[\d,]+$/ }).click();
  await expect(gemsTab).toHaveAttribute("aria-selected", "true");
});
