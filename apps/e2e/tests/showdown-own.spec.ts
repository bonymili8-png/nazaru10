import { expect, newOwner, sql, test } from "./fixtures.js";

test("two owners race their own horses in a showdown", async ({ page, browser }) => {
  // The host picks the third mode and enters a horse from their stable.
  await newOwner(page);
  await page.goto("/show/");
  await page.getByLabel("Showdown name (Latin letters)").fill("Stable Wars");
  await page.getByLabel("Your name on air (e.g. @handle)").fill("host_stable");
  await page.getByRole("radio", { name: /^Own horses/ }).click();
  // No pace horses in this mode: the option is gone; a horse must be picked first.
  await expect(page.getByText(/Fill each race with pace horses/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create and get the code" })).toBeDisabled();
  await page
    .getByRole("group", { name: /Your horses/ })
    .getByRole("checkbox")
    .first()
    .check();
  await page.getByRole("button", { name: "Create and get the code" }).click();
  await expect(page.getByRole("heading", { name: "Stable Wars" })).toBeVisible();
  const code = new URL(page.url()).searchParams.get("code")!;
  await expect(page.getByRole("heading", { name: "Your horses" })).toBeVisible();

  // A rival owner joins with a horse of their own.
  const ctx = await browser.newContext();
  const rival = await ctx.newPage();
  await newOwner(rival);
  await rival.goto(`/show/?code=${code}`);
  await rival.getByLabel("Your name on air (e.g. @handle)").fill("rival_stable");
  await rival
    .getByRole("group", { name: /Your horses/ })
    .getByRole("checkbox")
    .first()
    .check();
  await rival.getByRole("button", { name: "Join", exact: true }).click();
  await expect(rival.getByText("You're in — your horse is ready")).toBeVisible();
  const rivalHorse = (
    await rival
      .getByRole("heading", { name: "Your horses" })
      .locator("xpath=../following-sibling::*[1]")
      .getByRole("link")
      .first()
      .innerText()
  ).trim();

  // The race is called; tactics are chosen per horse.
  await expect(page.getByText("rival_stable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Call the next race/ }).click();
  await expect(rival.getByText("Tactics for each of your horses")).toBeVisible();
  await rival.getByRole("radiogroup", { name: rivalHorse }).getByRole("radio", { name: "Closer" }).click();
  await expect(
    rival.getByRole("radiogroup", { name: rivalHorse }).getByRole("radio", { name: "Closer" }),
  ).toHaveAttribute("aria-checked", "true");

  // Off and finished (moved on in the database): only the two stable horses ran, both linked.
  await sql(
    "UPDATE showdown_races SET starts_at = now() - interval '3 seconds' WHERE showdown_id = (SELECT id FROM showdowns WHERE code = $1)",
    [code],
  );
  await expect(page.getByText("LIVE").first()).toBeVisible();
  await sql(
    "UPDATE showdown_races SET results_at = now() WHERE status = 'RUN' AND showdown_id = (SELECT id FROM showdowns WHERE code = $1)",
    [code],
  );
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByText(/\(\+10\)/)).toBeVisible();
  await expect(page.getByText(/\(\+8\)/)).toBeVisible();
  await expect(page.getByRole("link", { name: rivalHorse }).first()).toHaveAttribute(
    "href",
    /^\/horse\/\?id=/,
  );
  await ctx.close();
});
