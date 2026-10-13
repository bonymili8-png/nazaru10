import { expect, newOwner, test } from "./fixtures.js";

test("owners find each other through a race, look round a stable and make an offer", async ({
  page,
  browser,
}) => {
  // Owner A enters a maiden race.
  await newOwner(page);
  await page.getByRole("link", { name: "Races" }).click();
  await page.getByRole("button", { name: "Maiden", exact: true }).click();
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "Maiden", exact: true }).click();
    await expect(page.locator("a[href^='/race/?id=']").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await page.locator("a[href^='/race/?id=']").first().click();
  await page.getByRole("radio", { name: /Closer/ }).click();
  await page.getByRole("button", { name: /^Enter · / }).click();
  await expect(page.getByText("Entered! Good luck.")).toBeVisible();
  const raceUrl = page.url();

  // Owner B opens the race: every runner links to its horse, every owner to their stable.
  const other = await browser.newContext();
  const b = await other.newPage();
  await newOwner(b);
  await b.goto(raceUrl);
  const ownerLink = b.locator("a[href^='/owner/?id=']").first();
  await expect(ownerLink).toBeVisible();
  await expect(b.locator("a[href^='/horse/?id=']").first()).toBeVisible();
  await ownerLink.click();

  // The stable: horses with rating and attributes, and an offer on request.
  await expect(b.getByText(/^Owner: /)).toBeVisible();
  await expect(b.getByText("Speed", { exact: true }).first()).toBeVisible();
  await b.getByRole("button", { name: "Make an offer to buy" }).first().click();
  b.once("dialog", (d) => void d.accept());
  await b
    .getByRole("button", { name: /^Offer / })
    .first()
    .click();
  await expect(b.getByText("Offer sent to the owner")).toBeVisible();

  // A horse of theirs: attributes for everyone, potential behind a scouting report.
  await b.locator("main a[href^='/horse/?id=']").first().click();
  await expect(b.getByRole("link", { name: /^Owner: / })).toBeVisible();
  await expect(b.getByRole("button", { name: /^Scouting report · 300 gems/ })).toBeVisible();

  // Search finds owners by name.
  await b.getByRole("link", { name: "Rankings" }).click();
  await b.getByRole("link", { name: "Find owners" }).click();
  await b.getByPlaceholder("Name, @username or stable name").fill("Dev");
  await expect(b.locator("a[href^='/owner/?id=']").first()).toBeVisible();
  await other.close();
});
