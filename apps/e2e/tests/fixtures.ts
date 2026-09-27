import { test as base, expect, type Page } from "@playwright/test";

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
