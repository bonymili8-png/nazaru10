import { expect, newOwner, openFirstHorse, test } from "./fixtures.js";

test("an owner sells horse shares and another owner buys in", async ({ page, browser }) => {
  await newOwner(page);
  await openFirstHorse(page);
  await expect(page.getByRole("heading", { name: "Syndicate" })).toBeVisible();
  await page.getByLabel("Shares").selectOption("2");
  await page.getByRole("button", { name: "Offer 2 share(s)" }).click();
  await expect(page.getByText("Shares on offer")).toBeVisible();
  await expect(page.getByText(/2 share\(s\) on offer at/)).toBeVisible();
  const horseUrl = page.url();

  // A second owner in a separate session buys one share.
  const investor = await browser.newPage();
  await newOwner(investor);
  await investor.goto(horseUrl);
  await expect(investor.getByRole("heading", { name: "Syndicate" })).toBeVisible();
  investor.once("dialog", (d) => void d.accept());
  await investor.getByRole("button", { name: /^Buy · / }).click();
  await expect(investor.getByText("Welcome to the syndicate!")).toBeVisible();
  await expect(investor.getByText("You hold 1 share(s) of this horse.")).toBeVisible();
  await investor.screenshot({ path: "/tmp/claude-0/shots/syndicate-investor.png", fullPage: true });

  await investor.getByRole("link", { name: "Market" }).click();
  await investor.getByRole("tab", { name: "Shares" }).click();
  await expect(investor.getByText(/1\/10 shares · paid/)).toBeVisible();
  await investor.close();

  // The manager now sees the partner and can dissolve the syndicate.
  await page.reload();
  await expect(page.getByRole("button", { name: "Dissolve syndicate" })).toBeVisible();
  await expect(page.getByText(/1 share\(s\) on offer at/)).toBeVisible();
});
