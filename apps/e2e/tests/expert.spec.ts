import pg from "pg";
import { expect, newOwner, openFirstHorse, test } from "./fixtures.js";

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://thoroughline:thoroughline@localhost:5432/thoroughline_e2e";

test("expert trainer's advice is offered per horse and shows a full plan once bought", async ({ page }) => {
  const devId = await newOwner(page);
  await openFirstHorse(page);
  await expect(page.getByRole("heading", { name: "Expert trainer's advice" })).toBeVisible();
  await page.getByRole("button", { name: "Unlock for 60 gems" }).click();
  await expect(page.getByText("Not enough gems.")).toBeVisible();

  // Simulate the purchase (a new owner has no gems) and read the plan.
  const horseId = new URL(page.url()).searchParams.get("id")!;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query(
    "INSERT INTO advice_unlocks (user_id, horse_id) SELECT id, $2 FROM users WHERE telegram_id = $1",
    [devId, horseId],
  );
  await client.end();
  await page.reload();
  await expect(page.getByText("Best tactics")).toBeVisible();
  await expect(page.getByText("Ideal conditions")).toBeVisible();
  await expect(page.getByText("Training plan")).toBeVisible();
  await expect(page.getByText(/No races yet/)).toBeVisible();
  await page.getByText("Best tactics").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/claude-0/shots/expert.png" });
});
