import pg from "pg";
import { expect, newOwner, test } from "./fixtures.js";

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://thoroughline:thoroughline@localhost:5432/thoroughline_e2e";

/** Make the owner an Owners' Circle member (reports are free for members). */
async function makeMember(telegramId: number): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO subscriptions (user_id, product_id, status, period_end, charge_id)
       SELECT id, 'OWNERS_CIRCLE', 'ACTIVE', now() + interval '30 days', 'e2e' FROM users WHERE telegram_id = $1`,
      [telegramId],
    );
  } finally {
    await client.end();
  }
}

/** Move a race's clock into the past so the job runner locks, runs and settles it at once. */
async function fastForward(raceId: string): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE races SET locks_at = now() - interval '11 minutes', starts_at = now() - interval '10 minutes'
        WHERE id = $1`,
      [raceId],
    );
  } finally {
    await client.end();
  }
}

test("after a race the owner sees a locked report offer for their run", async ({ page }) => {
  test.setTimeout(120_000);
  const devId = await newOwner(page);
  await page.goto("/races/");
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "Maiden", exact: true }).click();
    await expect(page.locator("a[href^='/race/?id=']").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  // The latest maiden race: other tests use the first one, and this test fast-forwards its race.
  await page.locator("a[href^='/race/?id=']").last().click();
  await page.getByRole("button", { name: /^Enter · / }).click();
  await expect(page.getByText("Entered! Good luck.")).toBeVisible();

  const raceId = new URL(page.url()).searchParams.get("id")!;
  await fastForward(raceId);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Race report · /)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Unlock for 10 gems" })).toBeVisible();
  await expect(page.getByText("Free with Owners' Circle")).toBeVisible();
  // A new owner has no gems yet.
  await page.getByRole("button", { name: "Unlock for 10 gems" }).click();
  await expect(page.getByText("Not enough gems.")).toBeVisible();

  // Members read it for free: the full breakdown appears.
  await makeMember(devId);
  await page.reload();
  await expect(page.getByText("Position through the race")).toBeVisible();
  await expect(page.getByText("Sectional times")).toBeVisible();
  await expect(page.getByText(/Tactics: Mid pack/)).toBeVisible();
  await page.getByText("Position through the race").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/claude-0/shots/race-report.png", fullPage: false });
});
