import pg from "pg";
import { expect, headerCredits, newOwner, test } from "./fixtures.js";

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://thoroughline:thoroughline@localhost:5432/thoroughline_e2e";

async function setRole(telegramId: number, role: string): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("UPDATE users SET role = $2 WHERE telegram_id = $1", [telegramId, role]);
  } finally {
    await client.end();
  }
}

test("players never see the console", async ({ page }) => {
  await newOwner(page);
  await page.goto("/profile/");
  await expect(page.getByRole("heading", { name: "Invite friends" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Admin console/ })).toHaveCount(0);
  await page.goto("/admin/");
  await expect(page.getByText("No console access")).toBeVisible();
});

test("an economy admin reads the dashboard, adjusts a balance and cannot publish a bad config", async ({
  page,
}) => {
  const devId = await newOwner(page);
  await setRole(devId, "ECONOMY_ADMIN");
  const before = await headerCredits(page);
  await page.goto("/profile/");
  await page.getByRole("link", { name: /Admin console/ }).click();
  await expect(page.getByRole("heading", { name: "Supply" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Credits" })).toBeVisible();

  await page.getByRole("tab", { name: "users" }).click();
  await page.getByLabel("Search users").fill(String(devId));
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: new RegExp(`tg ${devId}`) }).click();
  await page.getByLabel("Amount (negative to remove)").fill("250");
  await page.getByLabel("Reason (required, audited)").first().fill("E2E goodwill credit");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Apply adjustment" }).click();
  await expect(page.getByText("Balance adjusted")).toBeVisible();
  await expect(page.getByText("E2E goodwill credit").first()).toBeVisible();
  await page.reload();
  await expect.poll(() => headerCredits(page)).toBe(before + 250);

  await page.getByRole("tab", { name: "config" }).click();
  await page.getByLabel("Override JSON").fill('{ "economy": { "startingCredits": "lots" } }');
  await page.getByLabel("Change note (required)").fill("E2E invalid change");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("alert").getByText("economy.startingCredits: expected a number")).toBeVisible();

  await page.getByRole("tab", { name: "audit" }).click();
  await expect(page.getByText("“E2E goodwill credit”").first()).toBeVisible();
});
