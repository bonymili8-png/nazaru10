import pg from "pg";
import { expect, newOwner, test } from "./fixtures.js";

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://thoroughline:thoroughline@localhost:5432/thoroughline_e2e";

test("the game team runs a live event; players see the banner", async ({ page, browser }) => {
  const devId = await newOwner(page);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("UPDATE users SET role = 'GAME_ADMIN' WHERE telegram_id = $1", [devId]);
  await client.end();

  await page.goto("/admin/");
  await page.getByRole("tab", { name: "liveops" }).click();
  const title = `Double XP ${Date.now() % 100000}`;
  await page.getByLabel("Title shown to players").fill(title);
  await page.getByLabel("Multiplier").fill("2");
  await page.getByLabel("Hours from now (max 168)").fill("1");
  await page.getByRole("button", { name: "Start event now" }).click();
  await expect(page.getByText("Event started")).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();

  const player = await browser.newPage();
  await newOwner(player);
  await expect(player.getByText(title)).toBeVisible();
  await expect(player.getByText("×2 Racing Pass XP").first()).toBeVisible();
  await player.close();

  // Cancel so other tests see an ordinary game.
  page.once("dialog", (d) => void d.accept());
  await page.locator("div").filter({ hasText: title }).getByRole("button", { name: "Cancel" }).last().click();
  await expect(page.getByText("Event cancelled")).toBeVisible();
});
