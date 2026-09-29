import { test as base, expect, type Page } from "@playwright/test";
import pg from "pg";

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://thoroughline:thoroughline@localhost:5432/thoroughline_e2e";

let seq = 0;

/** Sign in as a brand-new owner through the developer login (each test gets its own stable). */
export async function newOwner(page: Page): Promise<number> {
  // Unique across workers and across runs (the e2e database persists, and an id reused from an
  // earlier run could inherit that owner's role or state).
  const devId =
    50_000_000 +
    (Math.floor(Date.now() / 1000) % 100_000) * 10_000 +
    (process.pid % 100) * 100 +
    (++seq % 100);
  await page.goto("/");
  await page.evaluate((id) => localStorage.setItem("tl.devId", String(id)), devId);
  await page.getByRole("button", { name: "Enter as developer" }).click();
  await expect(page.getByRole("heading", { name: "Career path" })).toBeVisible();
  return devId;
}

/**
 * Give an owner a second horse (a copy of their starter, listed last), so a test can sell the
 * starter without tripping the "keep at least one horse" rule.
 */
export async function giveSpareHorse(devId: number): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const cols = (
      await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'horses' AND column_name NOT IN ('id', 'name', 'created_at')
            AND is_generated = 'NEVER'`,
      )
    ).rows.map((r) => `"${r.column_name}"`);
    await client.query(
      `INSERT INTO horses (name, created_at, ${cols.join(", ")})
       SELECT 'Spare ' || substr(md5(random()::text), 1, 8), now() + interval '1 day', ${cols.join(", ")}
         FROM horses WHERE owner_id = (SELECT id FROM users WHERE telegram_id = $1) LIMIT 1`,
      [devId],
    );
  } finally {
    await client.end();
  }
}

/** Unfold a foldable page section (heading with a toggle button) if it is folded. */
export async function openSection(page: Page, name: string | RegExp): Promise<void> {
  const toggle = page.getByRole("heading", { name, exact: typeof name === "string" }).getByRole("button");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Credits shown in the header wallet chip. */
export async function headerCredits(page: Page): Promise<number> {
  const chip = page.getByRole("link", { name: "Wallet and profile" }).locator("span").first();
  await expect(chip).not.toHaveText("—");
  return Number((await chip.innerText()).replace(/[^\d]/g, ""));
}

/** Open the owner's first horse. */
export async function openFirstHorse(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Horses" }).click();
  await page.locator("a[href^='/horse/?id=']").first().click();
  await expect(page.getByRole("tab", { name: "overview" })).toBeVisible();
  // The profile lists every attribute and a plain "Earned" stat (no raw placeholders).
  for (const attr of ["Speed", "Stamina", "Final kick", "Focus"])
    await expect(page.getByText(attr, { exact: true })).toBeVisible();
  await expect(page.getByText("Earned", { exact: true })).toBeVisible();
  await expect(page.getByText(/\{\w+\}/)).toHaveCount(0);
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await use(page);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});
export { expect };
